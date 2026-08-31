export async function onRequest(context) {
  return new Response(JSON.stringify({ok: true, msg: "functions work!"}), {
    headers: {"Content-Type": "application/json"}
  });
}
