// 反馈API - 接收用户反馈并保存到GitHub
export async function onRequestPost(context) {
  try {
    const { env } = context;
    const feedback = await context.request.json();
    
    // 验证必要字段
    if (!feedback.boxId || !feedback.type) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '缺少必要字段' 
      }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // 读取现有的feedback.json
    let feedbackList = [];
    try {
      const feedbackFile = await env.GITHUB_API.repos.getContent({
        owner: 'awadwd',
        repo: 'ArknightsAuthorizationSeriesdata_editor',
        path: 'feedback.json'
      });
      
      // 解码并解析现有数据
      const content = atob(feedbackFile.data.content);
      feedbackList = JSON.parse(content);
    } catch (error) {
      // 文件不存在，创建新数组
      if (error.status === 404) {
        feedbackList = [];
      } else {
        throw error;
      }
    }
    
    // 添加新反馈
    feedback.id = Date.now(); // 简单ID生成
    feedback.createTime = new Date().toISOString();
    feedback.status = 'pending'; // 待审核
    feedbackList.push(feedback);
    
    // 写回GitHub
    const content = btoa(JSON.stringify(feedbackList, null, 2));
    const params = {
      owner: 'awadwd',
      repo: 'ArknightsAuthorizationSeriesdata_editor',
      path: 'feedback.json',
      message: `新增反馈: ${feedback.boxId} - ${feedback.type}`,
      content: content
    };
    
    // 如果文件已存在，需要提供sha
    try {
      const existingFile = await env.GITHUB_API.repos.getContent({
        owner: 'awadwd',
        repo: 'ArknightsAuthorizationSeriesdata_editor',
        path: 'feedback.json'
      });
      params.sha = existingFile.data.sha;
    } catch (e) {
      // 文件不存在，不需要sha
    }
    
    await env.GITHUB_API.repos.createOrUpdateFileContents(params);
    
    return new Response(JSON.stringify({ 
      success: true,
      message: '反馈提交成功',
      id: feedback.id
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('反馈提交失败:', error);
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

// 处理OPTIONS请求（CORS预检）
export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
