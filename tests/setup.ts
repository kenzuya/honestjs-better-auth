import "reflect-metadata";

// Tests send requests to http://localhost; setting the base URL keeps Better Auth from warning on every instance.
process.env.BETTER_AUTH_URL ??= "http://localhost";
