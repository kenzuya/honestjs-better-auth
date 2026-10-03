import "reflect-metadata";
export * from "./decorators.ts";
export { AuthService } from "./auth-service.ts";
export {
	AuthGuard,
	type BaseUserSession,
	type UserSession,
} from "./auth-guard.ts";
export * from "./better-auth-plugin.ts";
export * from "./symbols.ts";
export {
	SetMetadata,
	applyDecorators,
	type ClassOrMethodDecorator,
} from "./metadata.ts";
