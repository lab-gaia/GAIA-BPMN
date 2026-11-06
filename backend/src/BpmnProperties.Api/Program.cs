using System.IO.Compression;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using BpmnProperties.Application;
using BpmnProperties.Domain;
using BpmnProperties.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 250 * 1024 * 1024);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 250 * 1024 * 1024);
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173", "null"];
builder.Services.AddCors(options => options.AddPolicy("desktop", policy => policy
    .SetIsOriginAllowed(origin => allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
    .AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition")));
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")
    ?? "Host=localhost;Database=bpmn_properties;Username=bpmn_properties;Password=change-me-for-local-use"));
builder.Services.AddSingleton<IObjectStorage, LocalFileStorage>();

var jwtKey = builder.Configuration["Auth:JwtKey"] ?? "change-me-gaia-bpmn-local-jwt-secret-key-min-32-chars";
var jwtIssuer = builder.Configuration["Auth:JwtIssuer"] ?? "gaia-bpmn-api";
var jwtAudience = builder.Configuration["Auth:JwtAudience"] ?? "gaia-bpmn-desktop";
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = signingKey,
        ValidateIssuer = true,
        ValidIssuer = jwtIssuer,
        ValidateAudience = true,
        ValidAudience = jwtAudience,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromMinutes(2),
        NameClaimType = ClaimTypes.Name,
        RoleClaimType = ClaimTypes.Role
    };
});

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("AdminOnly", policy => policy.RequireAuthenticatedUser().RequireRole(UserRole.Admin.ToString()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS users (
                "Id" uuid PRIMARY KEY,
                "Username" varchar(100) NOT NULL,
                "DisplayName" varchar(200) NOT NULL,
                "PasswordHash" varchar(500) NOT NULL,
                "Role" varchar(40) NOT NULL,
                "AvatarObjectKey" varchar(500),
                "AvatarContentType" varchar(200),
                "CreatedAt" timestamptz NOT NULL,
                "UpdatedAt" timestamptz NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_users_Username" ON users ("Username");
            """);

        if (!await db.Users.AnyAsync(x => x.Role == UserRole.Admin))
        {
            var adminUsername = builder.Configuration["Auth:AdminUsername"] ?? "admin";
            var adminPassword = builder.Configuration["Auth:AdminPassword"] ?? "admin123";
            var adminDisplayName = builder.Configuration["Auth:AdminDisplayName"] ?? "Administrador";
            db.Users.Add(new User(adminUsername, adminDisplayName, PasswordHasher.Hash(adminPassword), UserRole.Admin));
            await db.SaveChangesAsync();
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Could not ensure users table or seed admin user on startup.");
    }
}

app.UseExceptionHandler();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseCors("desktop");
if (!app.Environment.IsDevelopment()) app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).WithName("Health").AllowAnonymous();

var auth = app.MapGroup("/api/v1/auth");
auth.MapPost("/login", async (LoginRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password))
        return Results.BadRequest("Usuário e senha são obrigatórios.");

    var normalizedUsername = request.Username.Trim().ToLowerInvariant();
    var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Username == normalizedUsername, cancellationToken);
    if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash))
        return Results.Problem(title: "Credenciais inválidas", detail: "Usuário ou senha incorretos.", statusCode: StatusCodes.Status401Unauthorized);

    var claims = new[]
    {
        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new Claim(ClaimTypes.Name, user.Username),
        new Claim(ClaimTypes.Role, user.Role.ToString()),
        new Claim("display_name", user.DisplayName)
    };
    var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(
        issuer: jwtIssuer,
        audience: jwtAudience,
        claims: claims,
        expires: DateTime.UtcNow.AddDays(7),
        signingCredentials: credentials);
    var tokenString = new JwtSecurityTokenHandler().WriteToken(token);

    return Results.Ok(new LoginResponse(tokenString, ToUserResponse(user)));
}).AllowAnonymous();

var me = app.MapGroup("/api/v1/me").RequireAuthorization();
me.MapGet("/", async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var userId = GetCurrentUserId(principal);
    if (userId is null) return Results.Unauthorized();
    var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId.Value, cancellationToken);
    return user is null ? Results.Unauthorized() : Results.Ok(ToUserResponse(user));
});

me.MapPut("/", async (UpdateProfileRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.DisplayName))
        return Results.BadRequest("O nome de exibição é obrigatório.");

    var userId = GetCurrentUserId(principal);
    if (userId is null) return Results.Unauthorized();
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId.Value, cancellationToken);
    if (user is null) return Results.Unauthorized();

    user.UpdateProfile(request.DisplayName);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(ToUserResponse(user));
});

me.MapPut("/password", async (ChangePasswordRequest request, ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrEmpty(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 6)
        return Results.BadRequest("A nova senha deve ter no mínimo 6 caracteres.");

    var userId = GetCurrentUserId(principal);
    if (userId is null) return Results.Unauthorized();
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId.Value, cancellationToken);
    if (user is null) return Results.Unauthorized();

    if (!PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash))
        return Results.BadRequest("A senha atual informada está incorreta.");

    user.SetPasswordHash(PasswordHasher.Hash(request.NewPassword));
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

me.MapPost("/avatar", async (HttpRequest request, ClaimsPrincipal principal, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var userId = GetCurrentUserId(principal);
    if (userId is null) return Results.Unauthorized();
    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId.Value, cancellationToken);
    if (user is null) return Results.Unauthorized();

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.SingleOrDefault();
    var allowedTypes = new[] { "image/png", "image/jpeg", "image/webp" };
    if (file is null || file.Length <= 0 || file.Length > 5 * 1024 * 1024 || !allowedTypes.Contains(file.ContentType, StringComparer.OrdinalIgnoreCase))
        return Results.BadRequest("Envie uma imagem PNG, JPEG ou WEBP de até 5 MB.");

    var key = $"avatars/{user.Id}";
    await using var stream = file.OpenReadStream();
    await storage.PutAsync(key, stream, file.ContentType, cancellationToken);
    user.SetAvatar(key, file.ContentType);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(ToUserResponse(user));
}).DisableAntiforgery();

app.MapGet("/api/v1/users/{userId:guid}/avatar", async (Guid userId, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
    if (user?.AvatarObjectKey is null) return Results.NotFound();
    try
    {
        var stream = await storage.GetAsync(user.AvatarObjectKey, cancellationToken);
        return Results.File(stream, user.AvatarContentType ?? "image/png");
    }
    catch (FileNotFoundException)
    {
        return Results.NotFound();
    }
}).RequireAuthorization();

var users = app.MapGroup("/api/v1/users").RequireAuthorization("AdminOnly");
users.MapGet("/", async (AppDbContext db, CancellationToken cancellationToken) =>
{
    var list = await db.Users.AsNoTracking()
        .OrderBy(x => x.DisplayName)
        .ThenBy(x => x.Username)
        .ToListAsync(cancellationToken);
    return Results.Ok(list.Select(ToUserResponse));
});

users.MapPost("/", async (CreateUserRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.DisplayName) || string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 6)
        return Results.BadRequest("Usuário, nome de exibição e senha (mínimo 6 caracteres) são obrigatórios.");

    var normalizedUsername = request.Username.Trim().ToLowerInvariant();
    if (await db.Users.AnyAsync(x => x.Username == normalizedUsername, cancellationToken))
        return Results.Conflict("Já existe um usuário com este login.");

    if (!Enum.TryParse<UserRole>(request.Role, true, out var role))
        role = UserRole.Guest;

    var user = new User(normalizedUsername, request.DisplayName, PasswordHasher.Hash(request.Password), role);
    db.Users.Add(user);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/users/{user.Id}", ToUserResponse(user));
});

users.MapPost("/{userId:guid}/reset-password", async (Guid userId, ResetPasswordRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 6)
        return Results.BadRequest("A nova senha deve ter no mínimo 6 caracteres.");

    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
    if (user is null) return Results.NotFound();

    user.SetPasswordHash(PasswordHasher.Hash(request.NewPassword));
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

users.MapDelete("/{userId:guid}", async (Guid userId, ClaimsPrincipal principal, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var currentUserId = GetCurrentUserId(principal);
    if (currentUserId == userId)
        return Results.BadRequest("Não é permitido excluir o próprio usuário logado.");

    var user = await db.Users.SingleOrDefaultAsync(x => x.Id == userId, cancellationToken);
    if (user is null) return Results.NotFound();

    if (user.AvatarObjectKey is not null)
    {
        try
        {
            await storage.DeleteAsync(user.AvatarObjectKey, cancellationToken);
        }
        catch
        {
            // Ignore avatar deletion failure when removing user
        }
    }

    db.Users.Remove(user);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

var processes = app.MapGroup("/api/v1/processes").RequireAuthorization();
var organizations = app.MapGroup("/api/v1/organizations").RequireAuthorization();
organizations.MapGet("/", async (int? pageSize, AppDbContext db, CancellationToken cancellationToken) =>
    Results.Ok(await db.Organizations.AsNoTracking().OrderBy(x => x.Name)
        .Take(Math.Clamp(pageSize ?? 100, 1, 100))
        .Select(x => new OrganizationResponse(x.Id, x.Name, x.Code, x.IsActive))
        .ToListAsync(cancellationToken)));
organizations.MapGet("/{organizationId:guid}/suborganizations", async (Guid organizationId, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Organizations.AnyAsync(x => x.Id == organizationId, cancellationToken)) return Results.NotFound();
    return Results.Ok(await db.Suborganizations.AsNoTracking()
        .Where(x => x.OrganizationId == organizationId).OrderBy(x => x.Name)
        .Select(x => new SuborganizationResponse(x.Id, x.OrganizationId, x.Name, x.Code, x.IsActive))
        .ToListAsync(cancellationToken));
});
organizations.MapGet("/{organizationId:guid}/export", async (
    Guid organizationId, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var organization = await db.Organizations.AsNoTracking()
        .SingleOrDefaultAsync(x => x.Id == organizationId, cancellationToken);
    if (organization is null) return Results.NotFound();

    var suborganizations = await db.Suborganizations.AsNoTracking()
        .Where(x => x.OrganizationId == organizationId)
        .OrderBy(x => x.Name)
        .ToListAsync(cancellationToken);
    var bytes = await BuildExportZipAsync(organization.Name, suborganizations, db, storage, cancellationToken);
    return Results.File(bytes, "application/zip", $"{Slugify(organization.Name)}.zip");
});
organizations.MapGet("/{organizationId:guid}/suborganizations/{suborganizationId:guid}/export", async (
    Guid organizationId, Guid suborganizationId, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var suborganization = await db.Suborganizations.AsNoTracking()
        .SingleOrDefaultAsync(x => x.Id == suborganizationId && x.OrganizationId == organizationId, cancellationToken);
    if (suborganization is null) return Results.NotFound();

    var organization = await db.Organizations.AsNoTracking()
        .SingleAsync(x => x.Id == organizationId, cancellationToken);
    var bytes = await BuildExportZipAsync(organization.Name, [suborganization], db, storage, cancellationToken);
    return Results.File(bytes, "application/zip", $"{Slugify(suborganization.Name)}.zip");
});
organizations.MapPost("/", async (CreateOrganizationRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var organization = new Organization(request.Name, request.Code);
    db.Organizations.Add(organization);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/organizations/{organization.Id}",
        new OrganizationResponse(organization.Id, organization.Name, organization.Code, organization.IsActive));
}).RequireAuthorization("AdminOnly");
organizations.MapPut("/{organizationId:guid}", async (Guid organizationId, UpdateOrganizationRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var organization = await db.Organizations.SingleOrDefaultAsync(x => x.Id == organizationId, cancellationToken);
    if (organization is null) return Results.NotFound();
    organization.Rename(request.Name);
    organization.SetActive(request.IsActive);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new OrganizationResponse(organization.Id, organization.Name, organization.Code, organization.IsActive));
}).RequireAuthorization("AdminOnly");
organizations.MapPost("/{organizationId:guid}/suborganizations", async (Guid organizationId, CreateSuborganizationRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Organizations.AnyAsync(x => x.Id == organizationId, cancellationToken)) return Results.NotFound();
    var suborganization = new Suborganization(organizationId, request.Name, request.Code);
    db.Suborganizations.Add(suborganization);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/organizations/{organizationId}/suborganizations/{suborganization.Id}",
        new SuborganizationResponse(suborganization.Id, organizationId, suborganization.Name, suborganization.Code, suborganization.IsActive));
}).RequireAuthorization("AdminOnly");
organizations.MapPut("/{organizationId:guid}/suborganizations/{suborganizationId:guid}", async (
    Guid organizationId, Guid suborganizationId, UpdateOrganizationRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var suborganization = await db.Suborganizations.SingleOrDefaultAsync(
        x => x.Id == suborganizationId && x.OrganizationId == organizationId, cancellationToken);
    if (suborganization is null) return Results.NotFound();
    suborganization.Rename(request.Name);
    suborganization.SetActive(request.IsActive);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new SuborganizationResponse(
        suborganization.Id, suborganization.OrganizationId, suborganization.Name, suborganization.Code, suborganization.IsActive));
}).RequireAuthorization("AdminOnly");
processes.MapGet("/", async (int? pageSize, AppDbContext db, CancellationToken cancellationToken) =>
{
    var result = await db.Processes.AsNoTracking().OrderByDescending(x => x.UpdatedAt)
        .Take(Math.Clamp(pageSize ?? 100, 1, 100))
        .Select(x => new ProcessResponse(
            x.Id, x.ExternalKey, x.Name, x.FileName, x.UpdatedAt, x.Elements.Count,
            x.SuborganizationId, x.Suborganization.OrganizationId, x.Suborganization.Organization.Name, x.Suborganization.Name))
        .ToListAsync(cancellationToken);
    return Results.Ok(result);
});
processes.MapPost("/import", async (HttpRequest request, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.SingleOrDefault();
    if (file is null || file.Length <= 0 || file.Length > BpmnXml.MaxBytes || !file.FileName.EndsWith(".bpmn", StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest("Exactly one non-empty .bpmn file up to 10 MB is required.");
    Guid? requestedSuborganizationId = null;
    if (form.TryGetValue("suborganizationId", out var suborganizationValue) &&
        !string.IsNullOrWhiteSpace(suborganizationValue.ToString()))
    {
        if (!Guid.TryParse(suborganizationValue.ToString(), out var parsedSuborganizationId))
            return Results.BadRequest("suborganizationId must be a valid UUID.");
        requestedSuborganizationId = parsedSuborganizationId;
    }
    var suborganization = requestedSuborganizationId is null
        ? await db.Suborganizations.Include(x => x.Organization).OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken)
        : await db.Suborganizations.Include(x => x.Organization)
            .SingleOrDefaultAsync(x => x.Id == requestedSuborganizationId.Value, cancellationToken);
    if (suborganization is null || !suborganization.IsActive || !suborganization.Organization.IsActive)
        return Results.BadRequest("A valid active suborganization is required.");
    await using var uploaded = file.OpenReadStream();
    BpmnDocument parsed;
    try
    {
        parsed = BpmnXml.Parse(uploaded, file.FileName);
    }
    catch (InvalidDataException exception)
    {
        return Results.BadRequest(exception.Message);
    }
    var process = await db.Processes
        .Include(x => x.Elements)
        .ThenInclude(x => x.PropertyValues)
        .SingleOrDefaultAsync(x => x.ExternalKey == parsed.ExternalKey, cancellationToken);
    if (process is null)
    {
        process = new Process(parsed.ExternalKey, parsed.Name);
        process.AssignToSuborganization(suborganization.Id);
        db.Processes.Add(process);
    }
    else
    {
        process.Rename(parsed.Name);
        if (requestedSuborganizationId is not null) process.AssignToSuborganization(suborganization.Id);
    }
    var key = $"processes/{process.Id}/diagram.bpmn";
    process.AttachDiagram(key, Path.GetFileName(file.FileName));
    var definitions = await db.PropertyDefinitions.Where(x => x.ProcessId == null && (x.Key == "input" || x.Key == "output")).ToDictionaryAsync(x => x.Key, cancellationToken);
    foreach (var parsedElement in parsed.Elements)
    {
        var element = process.Elements.SingleOrDefault(x => x.ExternalElementId == parsedElement.ExternalElementId);
        if (element is null)
        {
            element = new BpmnElement(
                process.Id,
                parsedElement.ExternalElementId,
                parsedElement.ElementType,
                parsedElement.Name);
            process.Elements.Add(element);
        }
        else element.Rename(parsedElement.Name, parsedElement.ElementType);
        if (IsTaskElement(parsedElement.ElementType))
        {
            UpsertValue(db, element, definitions.GetValueOrDefault("input"), parsedElement.Input);
            UpsertValue(db, element, definitions.GetValueOrDefault("output"), parsedElement.Output);
        }
    }
    await db.SaveChangesAsync(cancellationToken);
    await using var xml = new MemoryStream(Encoding.UTF8.GetBytes(BpmnXml.Serialize(parsed.Xml)));
    await storage.PutAsync(key, xml, "application/xml", cancellationToken);
    return Results.Ok(new ProcessResponse(
        process.Id, process.ExternalKey, process.Name, process.FileName, process.UpdatedAt, parsed.Tasks.Count,
        process.SuborganizationId, suborganization.OrganizationId, suborganization.Organization.Name, suborganization.Name));
}).DisableAntiforgery().RequireAuthorization("AdminOnly");
processes.MapPost("/", async (CreateProcessRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var suborganization = request.SuborganizationId is null
        ? await db.Suborganizations.Include(x => x.Organization).OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken)
        : await db.Suborganizations.Include(x => x.Organization)
            .SingleOrDefaultAsync(x => x.Id == request.SuborganizationId.Value, cancellationToken);
    if (suborganization is null || !suborganization.IsActive || !suborganization.Organization.IsActive)
        return Results.BadRequest("A valid active suborganization is required.");
    var process = new Process(request.ExternalKey, request.Name);
    process.AssignToSuborganization(suborganization.Id);
    db.Processes.Add(process);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/processes/{process.Id}", new ProcessResponse(
        process.Id, process.ExternalKey, process.Name, process.FileName, process.UpdatedAt, 0,
        process.SuborganizationId, suborganization.OrganizationId, suborganization.Organization.Name, suborganization.Name));
}).RequireAuthorization("AdminOnly");
processes.MapPut("/{processId:guid}/organization", async (Guid processId, TransferProcessRequest request, AppDbContext db, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    var process = await db.Processes.SingleOrDefaultAsync(x => x.Id == processId, cancellationToken);
    var suborganization = await db.Suborganizations.Include(x => x.Organization)
        .SingleOrDefaultAsync(x => x.Id == request.SuborganizationId, cancellationToken);
    if (process is null || suborganization is null) return Results.NotFound();
    if (!suborganization.IsActive || !suborganization.Organization.IsActive) return Results.BadRequest("Target suborganization is inactive.");
    process.AssignToSuborganization(suborganization.Id);
    await db.SaveChangesAsync(cancellationToken);
    logger.LogInformation("Process {ProcessId} transferred to suborganization {SuborganizationId}.", processId, request.SuborganizationId);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");
processes.MapGet("/{processId:guid}/elements", async (Guid processId, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Processes.AnyAsync(x => x.Id == processId, cancellationToken)) return Results.NotFound();
    return Results.Ok(await db.Elements.AsNoTracking().Where(x => x.ProcessId == processId).OrderBy(x => x.ExternalElementId)
        .Select(x => new ElementResponse(
            x.Id, x.ProcessId, x.ExternalElementId, x.ElementType, x.Name,
            x.Description, x.Resources, x.Instructions)).ToListAsync(cancellationToken));
});
processes.MapPost("/{processId:guid}/elements", async (Guid processId, CreateElementRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Processes.AnyAsync(x => x.Id == processId, cancellationToken)) return Results.NotFound();
    var element = new BpmnElement(processId, request.ExternalElementId, request.ElementType, request.Name);
    db.Elements.Add(element);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/elements/{element.Id}", new ElementResponse(
        element.Id, element.ProcessId, element.ExternalElementId, element.ElementType, element.Name,
        element.Description, element.Resources, element.Instructions));
}).RequireAuthorization("AdminOnly");
processes.MapGet("/{processId:guid}/diagram", async (Guid processId, bool? download, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var process = await db.Processes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == processId, cancellationToken);
    if (process?.DiagramObjectKey is null) return Results.NotFound();
    try
    {
        var content = await storage.GetAsync(process.DiagramObjectKey, cancellationToken);
        return Results.File(content, "application/xml", download == true ? process.FileName ?? "diagram.bpmn" : null);
    }
    catch (FileNotFoundException)
    {
        return Results.NotFound();
    }
});
processes.MapGet("/{processId:guid}/tasks", async (Guid processId, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Processes.AnyAsync(x => x.Id == processId, cancellationToken)) return Results.NotFound();
    var inputId = await db.PropertyDefinitions.Where(x => x.ProcessId == null && x.Key == "input").Select(x => (Guid?)x.Id).SingleOrDefaultAsync(cancellationToken);
    var outputId = await db.PropertyDefinitions.Where(x => x.ProcessId == null && x.Key == "output").Select(x => (Guid?)x.Id).SingleOrDefaultAsync(cancellationToken);
    var elements = await db.Elements.AsNoTracking().Include(x => x.Attachments).Include(x => x.PropertyValues)
        .Where(x => x.ProcessId == processId).OrderBy(x => x.ExternalElementId).ToListAsync(cancellationToken);
    return Results.Ok(elements.Select(x => new TaskResponse(x.Id, x.ExternalElementId, x.Name, x.ElementType,
        x.Description,
        ReadValue(x, inputId), ReadValue(x, outputId),
        x.Resources, x.Instructions,
        x.Attachments.OrderBy(a => a.CreatedAt).Select(a => new AttachmentResponse(a.Id, a.FileName, a.ContentType, a.Size, a.CreatedAt)).ToList())));
});
processes.MapPut("/{processId:guid}/tasks", async (Guid processId, SaveTasksRequest request, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var process = await db.Processes.Include(x => x.Elements).ThenInclude(x => x.PropertyValues)
        .SingleOrDefaultAsync(x => x.Id == processId, cancellationToken);
    if (process?.DiagramObjectKey is null) return Results.NotFound();
    var definitions = await db.PropertyDefinitions.Where(x => x.ProcessId == null && (x.Key == "input" || x.Key == "output")).ToDictionaryAsync(x => x.Key, cancellationToken);
    var values = new Dictionary<string, (string? Input, string? Output)>();
    foreach (var item in request.Tasks)
    {
        var element = process.Elements.SingleOrDefault(x => x.ExternalElementId == item.ExternalElementId);
        if (element is null) continue;
        UpsertValue(db, element, definitions.GetValueOrDefault("input"), item.Input);
        UpsertValue(db, element, definitions.GetValueOrDefault("output"), item.Output);
        element.UpdateMetadata(item.Description, item.Resources, item.Instructions);
        values[item.ExternalElementId] = (item.Input, item.Output);
    }
    await using var source = await storage.GetAsync(process.DiagramObjectKey, cancellationToken);
    var parsed = BpmnXml.Parse(source, process.FileName);
    BpmnXml.ApplyTaskValues(parsed.Xml, values.ToDictionary(x => x.Key, x => x.Value));
    process.AttachDiagram(process.DiagramObjectKey!, process.FileName ?? "diagram.bpmn");
    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    await using var output = new MemoryStream(Encoding.UTF8.GetBytes(BpmnXml.Serialize(parsed.Xml)));
    await storage.PutAsync(process.DiagramObjectKey, output, "application/xml", cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");

var elements = app.MapGroup("/api/v1/elements").RequireAuthorization();
elements.MapPost("/{elementId:guid}/attachments", async (Guid elementId, HttpRequest request, AppDbContext db, IObjectStorage storage, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    if (!await db.Elements.AnyAsync(x => x.Id == elementId, cancellationToken)) return Results.NotFound();
    var form = await request.ReadFormAsync(cancellationToken);
    if (form.Files.Count == 0) return Results.BadRequest("At least one file is required.");
    var result = new List<AttachmentResponse>();
    foreach (var file in form.Files)
    {
        if (file.Length <= 0 || file.Length > 26_214_400) return Results.BadRequest("Each file must be between 1 byte and 25 MB.");
        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var allowedTypes = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = ["application/pdf"],
            [".png"] = ["image/png"],
            [".jpg"] = ["image/jpeg"],
            [".jpeg"] = ["image/jpeg"],
            [".svg"] = ["image/svg+xml"],
            [".docx"] = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            [".xlsx"] = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            [".bpmn"] = ["application/xml", "text/xml"]
        };
        if (!allowedTypes.TryGetValue(extension, out var acceptedTypes) ||
            !acceptedTypes.Contains(file.ContentType ?? string.Empty, StringComparer.OrdinalIgnoreCase))
            return Results.BadRequest("File extension and MIME type are not allowed.");
        var key = $"elements/{elementId}/{Guid.NewGuid():N}";
        try
        {
            await using var stream = file.OpenReadStream();
            await storage.PutAsync(key, stream, file.ContentType!, cancellationToken);
            var attachment = new ElementAttachment(elementId, key, Path.GetFileName(file.FileName), file.ContentType!, file.Length);
            db.ElementAttachments.Add(attachment);
            await db.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Attachment {AttachmentId} uploaded for element {ElementId}, size {Size}.", attachment.Id, elementId, file.Length);
            result.Add(new AttachmentResponse(attachment.Id, attachment.FileName, attachment.ContentType, attachment.Size, attachment.CreatedAt));
        }
        catch
        {
            await storage.DeleteAsync(key, cancellationToken);
            throw;
        }
    }
    return Results.Ok(result);
}).DisableAntiforgery().RequireAuthorization("AdminOnly");
elements.MapGet("/{elementId:guid}/attachments", async (Guid elementId, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Elements.AnyAsync(x => x.Id == elementId, cancellationToken)) return Results.NotFound();
    return Results.Ok(await db.ElementAttachments.AsNoTracking().Where(x => x.ElementId == elementId).OrderBy(x => x.CreatedAt)
        .Select(x => new AttachmentResponse(x.Id, x.FileName, x.ContentType, x.Size, x.CreatedAt)).ToListAsync(cancellationToken));
});
app.MapGet("/api/v1/attachments/{attachmentId:guid}/content", async (Guid attachmentId, bool? download, AppDbContext db, IObjectStorage storage, CancellationToken cancellationToken) =>
{
    var attachment = await db.ElementAttachments.AsNoTracking().SingleOrDefaultAsync(x => x.Id == attachmentId, cancellationToken);
    if (attachment is null) return Results.NotFound();
    try
    {
        await using var storedContent = await storage.GetAsync(attachment.ObjectKey, cancellationToken);
        using var buffer = new MemoryStream();
        await storedContent.CopyToAsync(buffer, cancellationToken);
        var content = buffer.ToArray();
        var isPdf = attachment.ContentType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase)
            && content.Length >= 5
            && content[0] == 0x25 && content[1] == 0x50 && content[2] == 0x44 && content[3] == 0x46 && content[4] == 0x2D;
        if (isPdf && download != true)
            return Results.File(content, attachment.ContentType);
        return Results.File(content, attachment.ContentType, attachment.FileName);
    }
    catch (FileNotFoundException)
    {
        return Results.NotFound();
    }
}).RequireAuthorization();
app.MapDelete("/api/v1/attachments/{attachmentId:guid}", async (Guid attachmentId, AppDbContext db, IObjectStorage storage, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    var attachment = await db.ElementAttachments.SingleOrDefaultAsync(x => x.Id == attachmentId, cancellationToken);
    if (attachment is null) return Results.NotFound();
    await storage.DeleteAsync(attachment.ObjectKey, cancellationToken);
    db.ElementAttachments.Remove(attachment);
    await db.SaveChangesAsync(cancellationToken);
    logger.LogInformation("Attachment {AttachmentId} removed.", attachmentId);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");

var definitions = app.MapGroup("/api/v1/property-definitions").RequireAuthorization();
definitions.MapGet("/", async (Guid? processId, AppDbContext db, CancellationToken cancellationToken) =>
{
    var query = db.PropertyDefinitions.AsNoTracking().Where(x => x.IsActive);
    if (processId.HasValue) query = query.Where(x => x.ProcessId == null || x.ProcessId == processId);
    var definitions = await query.OrderBy(x => x.DisplayOrder).ToListAsync(cancellationToken);
    return Results.Ok(definitions.Select(x => new PropertyDefinitionResponse(
        x.Id, x.ProcessId, x.Key, x.DisplayName, x.Description, x.DataType, x.IsRequired, x.IsActive,
        x.DisplayOrder, x.DefaultValueJson is null ? null : JsonSerializer.Deserialize<JsonElement>(x.DefaultValueJson, new JsonSerializerOptions()))));
});
definitions.MapPost("/", async (CreatePropertyDefinitionRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var definition = new PropertyDefinition(request.ProcessId, request.Key, request.DisplayName, request.DataType);
    definition.Configure(request.Description, request.IsRequired, request.DisplayOrder, request.DefaultValue?.GetRawText());
    db.PropertyDefinitions.Add(definition);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/v1/property-definitions/{definition.Id}", new PropertyDefinitionResponse(definition.Id, definition.ProcessId, definition.Key, definition.DisplayName, definition.Description, definition.DataType, definition.IsRequired, definition.IsActive, definition.DisplayOrder, request.DefaultValue));
}).RequireAuthorization("AdminOnly");
elements.MapGet("/{elementId:guid}/properties", async (Guid elementId, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Elements.AnyAsync(x => x.Id == elementId, cancellationToken)) return Results.NotFound();
    var values = await db.PropertyValues.AsNoTracking().Where(x => x.ElementId == elementId).Select(x => new { x.PropertyDefinitionId, x.ValueJson, x.UpdatedAt }).ToListAsync(cancellationToken);
    return Results.Ok(values.Select(x => new PropertyValueResponse(x.PropertyDefinitionId, JsonSerializer.Deserialize<JsonElement>(x.ValueJson), x.UpdatedAt)));
});
elements.MapPut("/{elementId:guid}/properties/{propertyId:guid}", async (Guid elementId, Guid propertyId, SetPropertyValueRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    if (!await db.Elements.AnyAsync(x => x.Id == elementId, cancellationToken)) return Results.NotFound();
    var definition = await db.PropertyDefinitions.SingleOrDefaultAsync(x => x.Id == propertyId && x.IsActive, cancellationToken);
    if (definition is null) return Results.NotFound();
    var validationError = PropertyValueValidation.Validate(definition, request.Value);
    if (validationError is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["value"] = [validationError] });
    var value = await db.PropertyValues.SingleOrDefaultAsync(x => x.ElementId == elementId && x.PropertyDefinitionId == propertyId, cancellationToken);
    if (value is null) db.PropertyValues.Add(new PropertyValue(elementId, propertyId, request.Value.GetRawText()));
    else value.Update(request.Value.GetRawText());
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization("AdminOnly");

static Guid? GetCurrentUserId(ClaimsPrincipal principal)
{
    var raw = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    return Guid.TryParse(raw, out var id) ? id : null;
}

static UserResponse ToUserResponse(User user) =>
    new(user.Id, user.Username, user.DisplayName, user.Role.ToString(), !string.IsNullOrWhiteSpace(user.AvatarObjectKey), user.CreatedAt);

static string? ReadValue(BpmnElement element, Guid? definitionId) =>
    definitionId.HasValue
        ? element.PropertyValues.SingleOrDefault(x => x.PropertyDefinitionId == definitionId) is { } value
            ? JsonSerializer.Deserialize<string>(value.ValueJson)
            : null
        : null;

static void UpsertValue(AppDbContext db, BpmnElement element, PropertyDefinition? definition, string? value)
{
    if (definition is null) return;
    var json = JsonSerializer.Serialize(value);
    var current = element.PropertyValues.SingleOrDefault(x => x.PropertyDefinitionId == definition.Id);
    if (current is null) db.PropertyValues.Add(new PropertyValue(element.Id, definition.Id, json));
    else current.Update(json);
}

static bool IsTaskElement(string elementType) =>
    elementType.EndsWith("Task", StringComparison.Ordinal)
    || elementType is "task" or "subProcess" or "callActivity";

app.Run();

static async Task<byte[]> BuildExportZipAsync(
    string organizationName,
    IReadOnlyList<Suborganization> suborganizations,
    AppDbContext db,
    IObjectStorage storage,
    CancellationToken cancellationToken)
{
    var suborganizationIds = suborganizations.Select(x => x.Id).ToArray();
    var processes = await db.Processes.AsNoTracking()
        .Where(x => suborganizationIds.Contains(x.SuborganizationId))
        .OrderBy(x => x.Suborganization.Name)
        .ThenBy(x => x.Name)
        .Select(x => new ExportProcessData(
            x.Id,
            x.Name,
            x.FileName,
            x.DiagramObjectKey,
            x.SuborganizationId,
            x.Suborganization.Name))
        .ToListAsync(cancellationToken);

    await using var output = new MemoryStream();
    using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
    {
        var rootHtml = suborganizations.Count == 1
            ? BuildSuborganizationHtml(suborganizations[0].Name, processes)
            : BuildIndexHtml(organizationName, organizationName, suborganizations, processes);
        AddZipEntry(archive, "index.html", rootHtml);

        foreach (var suborganization in suborganizations)
        {
            var suborganizationProcesses = processes.Where(x => x.SuborganizationId == suborganization.Id).ToList();
            var suborganizationPath = $"orgao-{Slugify(suborganization.Name)}-{suborganization.Id:N}.html";
            AddZipEntry(
                archive,
                suborganizationPath,
                BuildSuborganizationHtml(suborganization.Name, suborganizationProcesses));

            foreach (var process in suborganizationProcesses)
            {
                if (string.IsNullOrWhiteSpace(process.DiagramObjectKey))
                    continue;

                await using var diagram = await storage.GetAsync(process.DiagramObjectKey, cancellationToken);
                using var reader = new StreamReader(diagram);
                var xml = await reader.ReadToEndAsync(cancellationToken);
                var processPath = $"bpmn/{Slugify(process.Name)}-{process.Id:N}.html";
                AddZipEntry(archive, processPath, BuildProcessHtml(process.Name, xml));
            }
        }
    }

    return output.ToArray();
}

static void AddZipEntry(ZipArchive archive, string path, string content)
{
    var entry = archive.CreateEntry(path, CompressionLevel.Fastest);
    using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
    writer.Write(content);
}

static string BuildIndexHtml(
    string title,
    string organizationName,
    IReadOnlyList<Suborganization> suborganizations,
    IEnumerable<ExportProcessData> processes)
{
    var links = suborganizations.Select(suborganization =>
    {
        var path = $"orgao-{Slugify(suborganization.Name)}-{suborganization.Id:N}.html";
        var count = processes.Count(x => x.SuborganizationId == suborganization.Id);
        return $"<li><a href=\"{path}\">{HtmlEncoder.Default.Encode(suborganization.Name)}</a> <span>({count} BPMN(s))</span></li>";
    });
    var description = suborganizations.Count == 1
        ? $"BPMNs do órgão {HtmlEncoder.Default.Encode(title)}."
        : $"Órgãos da organização {HtmlEncoder.Default.Encode(organizationName)}.";
    return BuildHtml(title, description, $"<ul>{string.Join("", links)}</ul>");
}

static string BuildSuborganizationHtml(string name, IEnumerable<ExportProcessData> processes)
{
    var links = processes.Select(process =>
    {
        var path = $"bpmn/{Slugify(process.Name)}-{process.Id:N}.html";
        return process.DiagramObjectKey is null
            ? $"<li>{HtmlEncoder.Default.Encode(process.Name)} <span>(diagrama indisponível)</span></li>"
            : $"<li><a href=\"{path}\">{HtmlEncoder.Default.Encode(process.Name)}</a></li>";
    });
    return BuildHtml(name, $"BPMNs do órgão {HtmlEncoder.Default.Encode(name)}.", $"<ul>{string.Join("", links)}</ul>");
}

static string BuildProcessHtml(string name, string xml)
{
    var encodedXml = JsonSerializer.Serialize(xml);
    var body = $$"""
      <div id="canvas" class="canvas"></div>
      <script>
        const xml = {{encodedXml}};
        const viewer = new BpmnJS({ container: '#canvas' });
        viewer.importXML(xml).then(() => viewer.get('canvas').zoom('fit-viewport'));
      </script>
    """;
    return BuildHtml(name, "Visualização do diagrama BPMN.", body, includeBpmn: true);
}

static string BuildHtml(string title, string description, string body, bool includeBpmn = false)
{
    var bpmnScript = includeBpmn
        ? "<script src=\"https://unpkg.com/bpmn-js@17.3.0/dist/bpmn-viewer.production.min.js\"></script>"
        : "";
    const string style = """
          body { margin: 0; padding: 24px; color: #172b4d; font-family: Arial, sans-serif; }
          h1 { color: #0f4e5c; }
          li { margin: 12px 0; }
          a { color: #0f7f88; }
          span { color: #5e6c84; }
          .canvas { height: calc(100vh - 120px); border: 1px solid #dfe1e6; }
        """;
    return $$"""
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{HtmlEncoder.Default.Encode(title)}}</title>
        {{bpmnScript}}
        <style>{{style}}</style>
      </head>
      <body>
        <h1>{{HtmlEncoder.Default.Encode(title)}}</h1>
        <p>{{description}}</p>
        {{body}}
      </body>
      </html>
    """;
}

static string Slugify(string value)
{
    var normalized = value.Normalize(System.Text.NormalizationForm.FormD);
    var builder = new StringBuilder();
    foreach (var character in normalized)
    {
        if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character) == System.Globalization.UnicodeCategory.NonSpacingMark)
            continue;
        builder.Append(char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '-');
    }

    var slug = System.Text.RegularExpressions.Regex.Replace(builder.ToString(), "-+", "-").Trim('-');
    return string.IsNullOrWhiteSpace(slug) ? "exportacao" : slug;
}

sealed record ExportProcessData(
    Guid Id,
    string Name,
    string? FileName,
    string? DiagramObjectKey,
    Guid SuborganizationId,
    string SuborganizationName);
public partial class Program { }
