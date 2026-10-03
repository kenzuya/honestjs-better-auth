import { Service } from "@kenzuya/honest";

export interface Note {
	id: number;
	userId: string;
	text: string;
}

@Service()
export class NotesService {
	private readonly notes: Note[] = [];

	list(userId: string): Note[] {
		return this.notes.filter((note) => note.userId === userId);
	}

	create(userId: string, text: string): Note {
		const note = { id: this.notes.length + 1, userId, text };
		this.notes.push(note);
		return note;
	}
}
