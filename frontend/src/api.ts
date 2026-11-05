const API_ERROR_KEYS: Record<string, string> = {
  API_CREDENTIALS_MISSING: "errors.apiCredentials",
  API_AUTH_UNAVAILABLE: "errors.apiUnavailable",
  API_REQUEST_FAILED: "errors.apiUnavailable",
  API_INVALID_INPUT: "errors.apiInput",
  API_CONFIRM_REQUIRED: "errors.apiConfirm",
  API_NON_JSON_RESPONSE: "errors.apiResponse",
  API_RESPONSE_TOO_LARGE: "errors.apiTooLarge",
  API_REQUEST_TOO_LARGE: "errors.apiTooLarge",
  API_OPERATION_NOT_FOUND: "errors.notFound",
  AUTH_FORBIDDEN: "errors.forbidden",
  AUTH_USERNAME_EXISTS: "errors.usernameExists",
  AUTH_USER_NOT_FOUND: "errors.userNotFound",
  AUTH_PROFILE_NOT_FOUND: "errors.profileNotFound",
  AUTH_PROFILE_EXISTS: "errors.profileExists",
  AUTH_SYSTEM_PROFILE: "errors.systemProfile",
  AUTH_PROFILE_IN_USE: "errors.profileInUse",
  AUTH_SELF_LOCKOUT: "errors.selfLockout",
  AUTH_LAST_ADMIN: "errors.lastAdmin",
  "Tu sesión terminó. Vuelve a ingresar.": "errors.session",
  "No se pudo completar la solicitud. Intenta de nuevo.": "errors.request",
  "No se pudo cerrar la sesión. Intenta de nuevo.": "errors.logout",
  "Usuario o contraseña incorrectos": "errors.credentials",
  "El acceso al visor todavía no está configurado": "errors.notConfigured",
  "Inicia sesión para consultar los eventos": "errors.signIn",
  "Demasiados intentos. Espera cinco minutos.": "errors.rateLimited",
  "Espera unos minutos antes de volver a intentar": "errors.busy",
  "Origen no permitido": "errors.origin",
  "La fecha debe incluir una zona horaria": "errors.dateZone",
  "El inicio debe ser anterior al final": "errors.dateRange",
  "Evento no encontrado": "errors.notFound",
};
export function errorKey(error: unknown): string {
  return error instanceof ApiError ? error.message : "errors.request";
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      (typeof body.detail === "string" &&
      body.detail.startsWith("API_AUTH_FAILED:")
        ? "errors.apiAuth"
        : API_ERROR_KEYS[body.detail]) || "errors.request",
    );
  return body;
}
