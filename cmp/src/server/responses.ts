// Answers of the app's own form endpoints (src/pages/api/*). Never cached: they act for one person.

/** After a form: go to `location` (a path on this site) with a GET. */
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } })

/** Not found, with an empty body: also the answer for anything of an account the person is not in. */
export const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
