/** `Object.hasOwn` for the browsers the runtime supports: `Object.hasOwn` itself is missing before Safari 15.4. */
export const hasOwn = (o: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(o, key)
