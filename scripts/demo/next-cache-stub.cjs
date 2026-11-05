// Stand-in for next/cache when the demo seed runs outside Next: the record
// commands call revalidatePath, which needs a request context. There are no
// cached pages to invalidate while seeding, so these do nothing.
exports.revalidatePath = function revalidatePath() {};
exports.revalidateTag = function revalidateTag() {};
