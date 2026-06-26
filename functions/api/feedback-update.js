// 更新反馈状态API
// 用于更新单个反馈的状态（approve/reject）

export async function onRequestPut(context) {
  try {
    const { request, env } = context;
    const { feedbackId, status, reason } = await request.json();
    
    if (!feedbackId || !status) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必要参数' 
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const githubToken = env.GITHUB_TOKEN;
    if (!githubToken) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '服务器配置错误：缺少GitHub Token' 
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const cleanToken = githubToken.trim();
    const repoOwner = 'awadwd';
    const repoName = 'ArknightsAuthorizationSeriesdata_editor';
    const filePath = 'feedback.json';
    
    // 1. 读取现有的feedback.json
    const getResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`,
      {
        headers: {
          'Authorization': 'token ' + cleanToken,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Cloudflare-Worker'
        }
      }
    );
    
    if (!getResponse.ok) {
      throw new Error(`读取feedback.json失败: ${getResponse.status}`);
    }
    
    const fileData = await getResponse.json();
    const fileSha = fileData.sha;
    
    // 解码base64内容
    const binaryString = atob(fileData.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const content = new TextDecoder('utf-8').decode(bytes);
    const feedbackList = JSON.parse(content);
    
    // 2. 更新反馈状态
    const feedbackIndex = feedbackList.findIndex(f => f.id === feedbackId);
    if (feedbackIndex === -1) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '反馈不存在' 
      }), {
        status: 404,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    feedbackList[feedbackIndex].status = status;
    feedbackList[feedbackIndex].reviewInfo = {
      reviewer: 'admin', // 实际应该从登录状态获取
      reviewTime: new Date().toISOString(),
      reason: reason || ''
    };
    
    // 3. 写回GitHub
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(feedbackList, null, 2));
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const updatedContent = btoa(binary);
    
    const updateResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + cleanToken,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Worker'
        },
        body: JSON.stringify({
          message: `更新反馈状态: #${feedbackId} -> ${status}`,
          content: updatedContent,
          sha: fileSha,
          branch: 'master'
        })
      }
    );
    
    if (!updateResponse.ok) {
      const responseText = await updateResponse.text();
      let errorDetail = responseText;
      
      try {
        const errorData = JSON.parse(responseText);
        errorDetail = errorData.message || errorData.error || responseText;
      } catch (e) {
        // 如果不是JSON，使用原始文本
      }
      
      throw new Error(`更新反馈状态失败: ${errorDetail}`);
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: '反馈状态已更新'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('更新反馈状态失败:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
