// biome-ignore lint/suspicious/noExplicitAny: decorated classes can have any constructor signature
type Constructor = new (...args: any[]) => unknown;

/**
 * A decorator usable on classes and methods.
 */
export type ClassOrMethodDecorator = ClassDecorator & MethodDecorator;

/**
 * Stores `value` under `key`. On a class the metadata is set on the class itself, on a method
 * it is set on the method function, so it can be read back per route handler.
 */
export function SetMetadata<K extends string | symbol, V = unknown>(
	key: K,
	value: V,
): ClassOrMethodDecorator {
	return ((
		target: object,
		_propertyKey?: string | symbol,
		descriptor?: PropertyDescriptor,
	) => {
		if (descriptor) {
			Reflect.defineMetadata(key, value, descriptor.value);
			return descriptor;
		}
		Reflect.defineMetadata(key, value, target);
		return target;
	}) as ClassOrMethodDecorator;
}

/**
 * Applies several class or method decorators as one.
 */
export function applyDecorators(
	...decorators: ClassOrMethodDecorator[]
): ClassOrMethodDecorator {
	return ((
		target: object,
		propertyKey?: string | symbol,
		descriptor?: PropertyDescriptor,
	) => {
		for (const decorator of decorators) {
			if (descriptor && propertyKey !== undefined) {
				(decorator as MethodDecorator)(target, propertyKey, descriptor);
			} else {
				(decorator as ClassDecorator)(target as Constructor);
			}
		}
	}) as ClassOrMethodDecorator;
}

/**
 * Reads `key` from the first target that defines it, so handler metadata overrides class metadata.
 */
export function getAllAndOverride<T>(
	key: string | symbol,
	targets: (object | undefined)[],
): T | undefined {
	for (const target of targets) {
		if (!target) continue;
		const value = Reflect.getMetadata(key, target);
		if (value !== undefined) return value as T;
	}
	return undefined;
}

/**
 * Returns the names of all methods on a prototype and its parents, excluding constructors and accessors.
 */
export function getAllMethodNames(prototype: object | null): string[] {
	const methodNames = new Set<string>();

	for (
		let current = prototype;
		current && current !== Object.prototype;
		current = Object.getPrototypeOf(current)
	) {
		for (const name of Object.getOwnPropertyNames(current)) {
			if (name === "constructor") continue;
			const descriptor = Object.getOwnPropertyDescriptor(current, name);
			if (typeof descriptor?.value === "function") methodNames.add(name);
		}
	}

	return [...methodNames];
}

const hookProviders = new Set<Constructor>();

/**
 * Remembers a class decorated with `@Hook()` or `@DatabaseHook()`. The plugin wires only the
 * ones an application's DI container has instantiated, the same way Nest discovers providers.
 */
export function registerHookProvider(target: Constructor): void {
	hookProviders.add(target);
}

export function getHookProviders(): ReadonlySet<Constructor> {
	return hookProviders;
}
