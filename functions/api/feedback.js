// 反馈API - 接收用户反馈并保存到GitHub
// 使用原生fetch调用GitHub REST API

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const feedback = await request.json();
    
    // 调试：打印所有环境变量名（不打印值）
    console.log('环境变量列表:', Object.keys(env));
    console.log('GITHUB_TOKEN存在:', !!env.GITHUB_TOKEN);
    
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
    
    // 从环境变量获取GitHub Token
    const githubToken = env.GITHUB_TOKEN;
    if (!githubToken) {
      // 调试信息：返回环境变量状态（不暴露真实值）
      const envKeys = Object.keys(env);
      return new Response(JSON.stringify({ 
        success: false, 
        error: '服务器配置错误：缺少GitHub Token',
        debug: {
          envKeys: envKeys,
          envKeysCount: envKeys.length,
          GITHUB_TOKEN_exists: false,
          hint: '请在Cloudflare Pages Settings中配置环境变量 GITHUB_TOKEN'
        }
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // 清理Token（移除可能的换行符、空格）
    const cleanToken = githubToken.trim();
    if (cleanToken !== githubToken) {
      console.warn('GitHub Token包含首尾空格，已自动清理');
    }
    
    const repoOwner = 'awadwd';
    const repoName = 'ArknightsAuthorizationSeriesdata_editor';
    const filePath = 'feedback.json';
    
    // 1. 读取现有的feedback.json
    let feedbackList = [];
    let fileSha = null;
    
    try {
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
      
      if (getResponse.ok) {
        const fileData = await getResponse.json();
        fileSha = fileData.sha;
        const content = atob(fileData.content);
        feedbackList = JSON.parse(content);
      } else if (getResponse.status === 404) {
        // 文件不存在，创建新数组
        feedbackList = [];
      } else {
        // 正确处理非JSON错误响应
        const responseText = await getResponse.text();
        let errorDetail = responseText;
        
        // 尝试解析为JSON（如果可能）
        try {
          const errorData = JSON.parse(responseText);
          errorDetail = errorData.message || errorData.error || responseText;
        } catch (e) {
          // 如果不是JSON，使用原始文本
        }
        
        throw new Error(`GitHub API错误 ${getResponse.status}: ${errorDetail}`);
      }
    } catch (error) {
      console.error('读取feedback.json失败:', error);
      // 如果是404以外的错误，返回错误
      if (error.message.includes('404') === false && error.message.includes('Not Found') === false) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: '读取反馈数据失败',
          debug: {
            message: error.message,
            hint: '请检查GitHub Token权限和仓库名称'
          }
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // 2. 添加新反馈
    feedback.id = Date.now(); // 简单ID生成
    feedback.createTime = new Date().toISOString();
    feedback.status = 'pending'; // 待审核
    feedbackList.push(feedback);
    
    // 3. 写回GitHub
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(feedbackList, null, 2))));
    
    const updateData = {
      message: `新增反馈: ${feedback.boxId} - ${feedback.type}`,
      content: content,
      branch: 'master'
    };
    
    if (fileSha) {
      updateData.sha = fileSha;
    }
    
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
        body: JSON.stringify(updateData)
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
      
      throw new Error(`GitHub API更新失败 ${updateResponse.status}: ${errorDetail}`);
    }
    
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

// 处理GET请求（获取反馈列表）
export async function onRequestGet(context) {
  try {
    const { env } = context;
    
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
    
    if (getResponse.ok) {
      const fileData = await getResponse.json();
      const content = atob(fileData.content);
      const feedbackList = JSON.parse(content);
      
      return new Response(JSON.stringify({ 
        success: true,
        data: feedbackList
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } else if (getResponse.status === 404) {
      return new Response(JSON.stringify({ 
        success: true,
        data: []
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } else {
      const responseText = await getResponse.text();
      let errorDetail = responseText;
      
      try {
        const errorData = JSON.parse(responseText);
        errorDetail = errorData.message || errorData.error || responseText;
      } catch (e) {
        // 如果不是JSON，使用原始文本
      }
      
      throw new Error(`GitHub API错误 ${getResponse.status}: ${errorDetail}`);
    }
    
  } catch (error) {
    console.error('读取反馈列表失败:', error);
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
