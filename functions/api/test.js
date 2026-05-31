// Test endpoint to verify Functions are working
export async function onRequest(context) {
  return new Response(JSON.stringify({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    url: context.request.url
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
