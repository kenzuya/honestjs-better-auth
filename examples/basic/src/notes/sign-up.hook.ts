import { Service } from "@kenzuya/honest";
import {
	AfterHook,
	type AuthHookContext,
	Hook,
} from "@kenzuya/honest-better-auth";

@Hook()
@Service()
export class SignUpHook {
	@AfterHook("/sign-up/email")
	async afterSignUp(ctx: AuthHookContext) {
		const user = ctx.context.newSession?.user;
		if (user) console.log(`New user signed up: ${user.email}`);
	}
}
