import { Body, Controller, Get, Post } from "@kenzuya/honest";
import {
	AllowAnonymous,
	OptionalAuth,
	Session,
	type UserSession,
} from "@kenzuya/honest-better-auth";
import { NotesService } from "./notes.service";

@Controller("notes")
export class NotesController {
	constructor(private readonly notesService: NotesService) {}

	@AllowAnonymous()
	@Get("public")
	publicInfo() {
		return { message: "Anyone can read this." };
	}

	@OptionalAuth()
	@Get("greeting")
	greeting(@Session() session: UserSession | null) {
		return { message: `Hello, ${session?.user.name ?? "guest"}!` };
	}

	@Get()
	list(@Session() session: UserSession) {
		return this.notesService.list(session.user.id);
	}

	@Post()
	create(@Session() session: UserSession, @Body("text") text: string) {
		return this.notesService.create(session.user.id, text);
	}
}
