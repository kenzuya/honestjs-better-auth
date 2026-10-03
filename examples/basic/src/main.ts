import "reflect-metadata";
import { Application } from "@kenzuya/honest";
import { AuthGuard, BetterAuthPlugin } from "@kenzuya/honest-better-auth";
import { AppModule } from "./app.module";
import { auth } from "./auth";

const { hono } = await Application.create(AppModule, {
	plugins: [new BetterAuthPlugin({ auth })],
	// Every route requires a session unless it is marked @AllowAnonymous() or @OptionalAuth()
	components: { guards: [AuthGuard] },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`Server running on http://localhost:${port}`);

export default { port, fetch: hono.fetch };
