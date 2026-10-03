import { Module } from "@kenzuya/honest";
import { NotesController } from "./notes/notes.controller";
import { NotesService } from "./notes/notes.service";
import { SignUpHook } from "./notes/sign-up.hook";

@Module({
	controllers: [NotesController],
	services: [NotesService, SignUpHook],
})
export class AppModule {}
