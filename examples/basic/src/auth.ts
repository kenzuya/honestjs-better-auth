import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";

// No database is configured, so Better Auth keeps everything in memory and data resets on restart.
export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
	trustedOrigins: ["http://localhost:5173"],
	emailAndPassword: {
		enabled: true,
	},
	plugins: [bearer()],
	// Required for @Hook() services
	hooks: {},
});
