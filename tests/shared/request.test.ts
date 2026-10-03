import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import request from "./request.ts";

describe("request helper", () => {
	it("should send the request once when the builder is awaited twice", async () => {
		let requests = 0;
		const hono = new Hono();
		hono.post("/count", (c) => {
			requests += 1;
			return c.json({ requests });
		});

		const pending = request(hono).post("/count").send({}).expect(200);
		const first = await pending;
		const second = await pending;

		expect(requests).toBe(1);
		expect(second).toBe(first);
	});
});
