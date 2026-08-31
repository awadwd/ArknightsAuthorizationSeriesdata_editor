// 反馈 API - 接收用户反馈并保存到 GitHub（反馈仓库 = 部署仓库自身）
import { getAppConfig } from '../_lib/appConfig.js';

// 反馈存储仓库固定为部署仓库自身（即本 Pages 项目对应的 GitHub 仓库）
const FEEDBACK_REPO = { owner: 'awadwd', repo: 'ArknightsAuthorizationSeriesdata_editor' };

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const feedback = await request.json();

    // 验证必要字段
    if (!feedback.boxId || !feedback.type) {
      return new Response(JSON.stringify({
        success: false,
        error: '缺少必要字段'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 从环境变量获取 GitHub Token（secret，不入 KV）
    const githubToken = env.GITHUB_TOKEN;
    if (!githubToken) {
      return new Response(JSON.stringify({
        success: false,
        error: '服务器配置错误：缺少 GitHub Token',
        debug: { hint: '请在 Cloudflare Pages Settings 中配置环境变量 GITHUB_TOKEN' }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 清理 Token（移除可能的换行符、空格）
    const cleanToken = githubToken.trim();
    if (cleanToken !== githubToken) {
      console.warn('GitHub Token 包含首尾空格，已自动清理');
    }

    const cfg = await getAppConfig(env);
    const fb = (cfg && cfg.feedback) || {};
    const filePath = fb.storagePath || 'feedback.json';
    const branch = fb.branch || 'master';

    // 1. 读取现有的 feedback.json
    let feedbackList = [];
    let fileSha = null;

    try {
      const getResponse = await fetch(
        `https://api.github.com/repos/${FEEDBACK_REPO.owner}/${FEEDBACK_REPO.repo}/contents/${filePath}`,
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
        // 解码 base64 内容（处理 UTF-8）
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const content = new TextDecoder('utf-8').decode(bytes);
        feedbackList = JSON.parse(content);
      } else if (getResponse.status === 404) {
        // 文件不存在，创建新数据
        feedbackList = [];
      } else {
        const responseText = await getResponse.text();
        let errorDetail = responseText;
        try {
          const errorData = JSON.parse(responseText);
          errorDetail = errorData.message || errorData.error || responseText;
        } catch (e) {}
        throw new Error(`GitHub API 错误 ${getResponse.status}: ${errorDetail}`);
      }
    } catch (error) {
      console.error('读取 feedback.json 失败:', error);
      if (error.message.includes('404') === false && error.message.includes('Not Found') === false) {
        return new Response(JSON.stringify({
          success: false,
          error: '读取反馈数据失败',
          debug: { message: error.message }
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }

    // 2. 添加新反馈
    feedback.id = Date.now();
    feedback.createTime = new Date().toISOString();
    feedback.status = 'pending';
    feedbackList.push(feedback);

    // 3. 写回 GitHub（UTF-8 编码后转 base64）
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(feedbackList, null, 2));
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const content = btoa(binary);

    const updateData = {
      message: `新增反馈: ${feedback.boxId} - ${feedback.type}`,
      content: content,
      branch: branch
    };
    if (fileSha) updateData.sha = fileSha;

    const updateResponse = await fetch(
      `https://api.github.com/repos/${FEEDBACK_REPO.owner}/${FEEDBACK_REPO.repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'token ' + cleanToken,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json; charset=utf-8',
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
      } catch (e) {}
      throw new Error(`GitHub API 更新失败 ${updateResponse.status}: ${errorDetail}`);
    }

    return new Response(JSON.stringify({
      success: true,
      message: '反馈提交成功',
      id: feedback.id
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
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
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 处理 GET 请求（获取反馈列表）
export async function onRequestGet(context) {
  try {
    const { env } = context;

    const githubToken = env.GITHUB_TOKEN;
    if (!githubToken) {
      return new Response(JSON.stringify({
        success: false,
        error: '服务器配置错误：缺少 GitHub Token'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const cleanToken = githubToken.trim();
    const cfg = await getAppConfig(env);
    const fb = (cfg && cfg.feedback) || {};
    const filePath = fb.storagePath || 'feedback.json';

    const getResponse = await fetch(
      `https://api.github.com/repos/${FEEDBACK_REPO.owner}/${FEEDBACK_REPO.repo}/contents/${filePath}`,
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
      const binaryString = atob(fileData.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const content = new TextDecoder('utf-8').decode(bytes);
      const feedbackList = JSON.parse(content);

      return new Response(JSON.stringify({
        success: true,
        data: feedbackList
      }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } else if (getResponse.status === 404) {
      return new Response(JSON.stringify({
        success: true,
        data: []
      }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } else {
      const responseText = await getResponse.text();
      let errorDetail = responseText;
      try {
        const errorData = JSON.parse(responseText);
        errorDetail = errorData.message || errorData.error || responseText;
      } catch (e) {}
      throw new Error(`GitHub API 错误 ${getResponse.status}: ${errorDetail}`);
    }

  } catch (error) {
    console.error('读取反馈列表失败:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 处理 OPTIONS 请求（CORS 预检）
export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
