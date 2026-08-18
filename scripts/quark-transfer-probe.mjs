import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuarkCredentialStore } from '../server/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const shareUrlArg = process.argv.find(value => value.startsWith('--share-url='));
const shareUrl = shareUrlArg?.slice('--share-url='.length) || '';
const pwdId = shareUrl.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i)?.[1] || '';
const cookie = new QuarkCredentialStore(dataDir).getCookie();
const apiHost = 'https://drive-pc.quark.cn/1/clouddrive';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/3.14.2 Chrome/112.0.5615.165 Electron/24.1.3.8 Safari/537.36 Channel/pckk_other_ch';
const browserUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const shareUserAgent = process.argv.includes('--mixed-user-agent') ? browserUserAgent : userAgent;

if (!cookie || !pwdId) {
  console.error(JSON.stringify({ ok: false, stage: !cookie ? 'missing_cookie' : 'missing_share_url' }));
  process.exit(1);
}

const requestJson = async (pathName, { method = 'GET', body, params = {}, requestUserAgent = userAgent } = {}) => {
  const url = new URL(`${apiHost}/${pathName}`);
  url.searchParams.set('pr', 'ucpro');
  url.searchParams.set('fr', 'pc');
  url.searchParams.set('uc_param_str', '');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': requestUserAgent,
      Referer: 'https://pan.quark.cn/',
      Cookie: cookie
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json().catch(() => ({}));
  return { httpStatus: response.status, result };
};

const publicResult = response => ({
  httpStatus: response?.httpStatus,
  code: response?.result?.code,
  status: response?.result?.status,
  message: response?.result?.message || response?.result?.message_desc || ''
});

const report = { ok: false, stages: {} };
let temporaryFolderFid = '';

try {
  const tokenResponse = await requestJson('share/sharepage/token', {
    method: 'POST',
    requestUserAgent: shareUserAgent,
    body: { pwd_id: pwdId, passcode: '' }
  });
  report.stages.token = publicResult(tokenResponse);
  const stoken = tokenResponse.result?.data?.stoken || '';
  if (!stoken) throw new Error('share_token_unavailable');

  const queue = ['0'];
  let selectedVideo = null;
  while (queue.length && !selectedVideo) {
    const parentFid = queue.shift();
    const detailResponse = await requestJson('share/sharepage/detail', {
      requestUserAgent: shareUserAgent,
      params: {
        pwd_id: pwdId,
        stoken,
        pdir_fid: parentFid,
        page: 1,
        size: 100,
        force: 0,
        fetch_banner: 0,
        fetch_share: 0,
        fetch_total: 1,
        sort: 'file_type:asc,updated_at:desc'
      }
    });
    report.stages.detail = publicResult(detailResponse);
    const list = Array.isArray(detailResponse.result?.data?.list) ? detailResponse.result.data.list : [];
    for (const item of list) {
      if (item.file_type === 0 || item.dir) queue.push(item.fid);
      else if (String(item.format_type || '').startsWith('video') || /\.(mp4|mkv|mov|m4v|ts|webm)$/i.test(item.file_name || '')) {
        selectedVideo = item;
        break;
      }
    }
    if (queue.length > 20) queue.length = 20;
  }
  if (!selectedVideo) throw new Error('shared_video_unavailable');

  const folderResponse = await requestJson('file', {
    method: 'POST',
    body: {
      pdir_fid: '0',
      file_name: `.misty-rain-transfer-probe-${Date.now()}`,
      dir_path: '',
      dir_init_lock: false
    }
  });
  report.stages.createTemporaryFolder = publicResult(folderResponse);
  temporaryFolderFid = folderResponse.result?.data?.fid || '';
  if (!temporaryFolderFid) throw new Error('temporary_folder_unavailable');

  const saveResponse = await requestJson('share/sharepage/save', {
    method: 'POST',
    body: {
      fid_list: [selectedVideo.fid],
      fid_token_list: [selectedVideo.share_fid_token],
      to_pdir_fid: temporaryFolderFid,
      pwd_id: pwdId,
      stoken,
      pdir_fid: '0',
      scene: 'link'
    }
  });
  report.stages.save = publicResult(saveResponse);
  if (Number(saveResponse.result?.code) !== 0) throw new Error('save_rejected');

  const taskId = saveResponse.result?.data?.task_id || '';
  let savedFids = saveResponse.result?.data?.save_as?.save_as_top_fids
    || saveResponse.result?.data?.save_as_top_fids
    || [];
  for (let retry = 0; taskId && !savedFids.length && retry < 15; retry += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const taskResponse = await requestJson('task', {
      params: { task_id: taskId, retry_index: retry }
    });
    report.stages.task = publicResult(taskResponse);
    savedFids = taskResponse.result?.data?.save_as?.save_as_top_fids
      || taskResponse.result?.data?.save_as_top_fids
      || [];
  }
  report.ok = savedFids.length > 0;
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'unknown_failure';
} finally {
  if (temporaryFolderFid) {
    try {
      const cleanupResponse = await requestJson('file/delete', {
        method: 'POST',
        body: {
          action_type: 2,
          filelist: [temporaryFolderFid],
          exclude_fids: []
        }
      });
      report.stages.cleanup = publicResult(cleanupResponse);
    } catch {
      report.stages.cleanup = { message: 'cleanup_request_failed' };
    }
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
