import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuarkCredentialStore } from '../server/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const readJson = (fileName, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(projectRoot, fileName), 'utf8'));
  } catch {
    return fallback;
  }
};

const cards = readJson('data/media_cards.json', []);
const cookie = new QuarkCredentialStore(path.resolve(projectRoot, 'data')).getCookie();
const card = cards.find(item => /pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(item?.quarkShareUrl || ''));
const shareUrlArg = process.argv.find(value => value.startsWith('--share-url='));
const shareUrl = shareUrlArg ? shareUrlArg.slice('--share-url='.length) : (card?.quarkShareUrl || '');
const pwdId = shareUrl.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i)?.[1] || '';
const shouldTransfer = process.argv.includes('--transfer');

if (!cookie || !pwdId) {
  console.error(JSON.stringify({
    ok: false,
    reason: !cookie ? 'missing_cookie' : 'missing_real_share_url'
  }, null, 2));
  process.exitCode = 1;
} else {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://pan.quark.cn/',
    'Cookie': cookie
  };

  const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { ...commonHeaders, ...(options.headers || {}) }
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawType: response.headers.get('content-type') || 'unknown', rawLength: text.length };
    }
    return { httpStatus: response.status, body };
  };

  const redact = (value, depth = 0) => {
    if (depth > 6) return '[depth-limited]';
    if (Array.isArray(value)) return value.slice(0, 4).map(item => redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/cookie|token|url|fid|sign|ticket|secret/i.test(key)) {
        if (Array.isArray(item)) return [item.length ? '[redacted]' : ''];
        return item ? '[redacted]' : item;
      }
      return [key, redact(item, depth + 1)];
    }));
  };

  const report = {
    ok: true,
    account: {},
    share: { cardTitle: shareUrlArg ? 'provided-share' : (card?.title || 'unknown') },
    playCandidates: []
  };

  const accountCandidates = [
    'https://pan.quark.cn/account/info',
    'https://drive-pc.quark.cn/1/clouddrive/member?pr=ucpro&fr=pc'
  ];

  for (const url of accountCandidates) {
    try {
      const result = await requestJson(url, { method: 'GET' });
      report.account[new URL(url).pathname] = {
        httpStatus: result.httpStatus,
        code: result.body?.code,
        status: result.body?.status,
        dataKeys: Object.keys(result.body?.data || {})
      };
    } catch (error) {
      report.account[new URL(url).pathname] = { error: error.message };
    }
  }

  const tokenResult = await requestJson('https://drive.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc', {
    method: 'POST',
    body: JSON.stringify({ pwd_id: pwdId, passcode: '' })
  });
  const stoken = tokenResult.body?.data?.stoken || '';
  report.share.token = {
    httpStatus: tokenResult.httpStatus,
    code: tokenResult.body?.code,
    status: tokenResult.body?.status,
    dataKeys: Object.keys(tokenResult.body?.data || {}),
    title: tokenResult.body?.data?.title || ''
  };

  const queue = ['0'];
  let selectedVideo = null;
  let scannedDirectories = 0;
  let scannedFiles = 0;
  const discoveredItems = [];
  let sharedRootFolder = null;

  while (queue.length && !selectedVideo && scannedDirectories < 12) {
    const pdirFid = queue.shift();
    scannedDirectories += 1;
    const detailUrl = new URL('https://drive.quark.cn/1/clouddrive/share/sharepage/detail');
    detailUrl.searchParams.set('pwd_id', pwdId);
    detailUrl.searchParams.set('stoken', stoken);
    detailUrl.searchParams.set('pdir_fid', pdirFid);
    detailUrl.searchParams.set('page', '1');
    detailUrl.searchParams.set('size', '100');
    const detailResult = await requestJson(detailUrl, { method: 'GET' });
    const list = detailResult.body?.data?.list || [];
    if (pdirFid === '0' && list.length === 1 && list[0]?.file_type === 0) sharedRootFolder = list[0];
    scannedFiles += list.length;
    discoveredItems.push(...list.slice(0, 20).map(item => ({
      fileName: item.file_name,
      fileType: item.file_type,
      formatType: item.format_type,
      category: item.category,
      size: item.size
    })));

    for (const item of list) {
      if (item.file_type === 0) {
        queue.push(item.fid);
        continue;
      }
      const name = String(item.file_name || '').toLowerCase();
      const isVideo = item.format_type?.startsWith('video') || /\.(mp4|mkv|mov|m4v|ts|avi|webm)$/.test(name);
      if (isVideo) {
        selectedVideo = item;
        break;
      }
    }
  }

  report.share.directory = {
    stokenAvailable: Boolean(stoken),
    selectedVideoAvailable: Boolean(selectedVideo),
    scannedDirectories,
    scannedFiles,
    discoveredItems: discoveredItems.slice(0, 30),
    selectedVideoKeys: Object.keys(selectedVideo || {})
  };

  if (sharedRootFolder?.fid) {
    const ownFolderUrl = new URL('https://drive-pc.quark.cn/1/clouddrive/file/sort');
    ownFolderUrl.searchParams.set('pr', 'ucpro');
    ownFolderUrl.searchParams.set('fr', 'pc');
    ownFolderUrl.searchParams.set('pdir_fid', sharedRootFolder.fid);
    ownFolderUrl.searchParams.set('_page', '1');
    ownFolderUrl.searchParams.set('_size', '10');
    ownFolderUrl.searchParams.set('_fetch_total', '1');
    ownFolderUrl.searchParams.set('_fetch_sub_dirs', '0');
    ownFolderUrl.searchParams.set('_sort', 'file_type:asc,updated_at:desc');
    const ownFolderResult = await requestJson(ownFolderUrl, { method: 'GET' });
    report.share.ownDriveAccess = {
      httpStatus: ownFolderResult.httpStatus,
      code: ownFolderResult.body?.code,
      status: ownFolderResult.body?.status,
      accessible: ownFolderResult.body?.code === 0,
      itemCount: ownFolderResult.body?.data?.list?.length || 0
    };
  }

  if (selectedVideo) {
    const body = {
      fid: selectedVideo.fid,
      pwd_id: pwdId,
      stoken,
      share_fid_token: selectedVideo.share_fid_token,
      resolutions: 'normal,low,high,super,2k,4k',
      supports: 'fmp4,m3u8',
      scene: 'link'
    };

    const candidates = [
      'https://drive.quark.cn/1/clouddrive/share/sharepage/play?pr=ucpro&fr=pc',
      'https://drive-pc.quark.cn/1/clouddrive/share/sharepage/play?pr=ucpro&fr=pc',
      'https://drive.quark.cn/1/clouddrive/file/v2/play?pr=ucpro&fr=pc',
      'https://drive-pc.quark.cn/1/clouddrive/file/v2/play?pr=ucpro&fr=pc'
    ];

    for (const url of candidates) {
      try {
        const result = await requestJson(url, { method: 'POST', body: JSON.stringify(body) });
        report.playCandidates.push({
          host: new URL(url).host,
          path: new URL(url).pathname,
          httpStatus: result.httpStatus,
          code: result.body?.code,
          status: result.body?.status,
          message: result.body?.message || result.body?.message_desc,
          dataKeys: Object.keys(result.body?.data || {}),
          sample: redact(result.body?.data || {})
        });
      } catch (error) {
        report.playCandidates.push({ host: new URL(url).host, path: new URL(url).pathname, error: error.message });
      }
    }

    if (shouldTransfer) {
      const driveBase = 'https://drive-pc.quark.cn/1/clouddrive';
      const listUrl = new URL(`${driveBase}/file/sort`);
      listUrl.searchParams.set('pr', 'ucpro');
      listUrl.searchParams.set('fr', 'pc');
      listUrl.searchParams.set('pdir_fid', '0');
      listUrl.searchParams.set('_page', '1');
      listUrl.searchParams.set('_size', '100');
      listUrl.searchParams.set('_fetch_total', '1');
      listUrl.searchParams.set('_fetch_sub_dirs', '0');
      listUrl.searchParams.set('_sort', 'file_type:asc,updated_at:desc');

      const rootResult = await requestJson(listUrl, { method: 'GET' });
      const rootList = rootResult.body?.data?.list || [];
      let targetFolder = rootList.find(item => item.file_type === 0 && item.file_name === '烟雨影视');
      let folderCreated = false;

      if (!targetFolder) {
        const createResult = await requestJson(`${driveBase}/file?pr=ucpro&fr=pc`, {
          method: 'POST',
          body: JSON.stringify({
            pdir_fid: '0',
            file_name: '烟雨影视',
            dir_path: '',
            dir_init_lock: false
          })
        });
        targetFolder = createResult.body?.data;
        folderCreated = createResult.body?.code === 0 && Boolean(targetFolder?.fid);
        report.transfer = {
          folderCreated,
          createHttpStatus: createResult.httpStatus,
          createCode: createResult.body?.code,
          createMessage: createResult.body?.message,
          createDataKeys: Object.keys(createResult.body?.data || {})
        };
      } else {
        report.transfer = { folderCreated: false, folderReused: true };
      }

      if (targetFolder?.fid) {
        const saveResult = await requestJson(`${driveBase}/share/sharepage/save?pr=ucpro&fr=pc`, {
          method: 'POST',
          body: JSON.stringify({
            fid_list: [selectedVideo.fid],
            fid_token_list: [selectedVideo.share_fid_token],
            to_pdir_fid: targetFolder.fid,
            pwd_id: pwdId,
            stoken,
            pdir_fid: selectedVideo.pdir_fid || '0',
            scene: 'link'
          })
        });

        report.transfer.save = {
          httpStatus: saveResult.httpStatus,
          code: saveResult.body?.code,
          status: saveResult.body?.status,
          message: saveResult.body?.message || saveResult.body?.message_desc,
          dataKeys: Object.keys(saveResult.body?.data || {})
        };

        const taskId = saveResult.body?.data?.task_id;
        let savedFid = saveResult.body?.data?.save_as?.save_as_top_fids?.[0]
          || saveResult.body?.data?.save_as_top_fids?.[0]
          || '';

        if (taskId && !savedFid) {
          for (let retry = 0; retry < 12 && !savedFid; retry += 1) {
            await new Promise(resolve => setTimeout(resolve, 600));
            const taskUrl = new URL(`${driveBase}/task`);
            taskUrl.searchParams.set('pr', 'ucpro');
            taskUrl.searchParams.set('fr', 'pc');
            taskUrl.searchParams.set('task_id', taskId);
            taskUrl.searchParams.set('retry_index', String(retry));
            const taskResult = await requestJson(taskUrl, { method: 'GET' });
            savedFid = taskResult.body?.data?.save_as?.save_as_top_fids?.[0]
              || taskResult.body?.data?.save_as_top_fids?.[0]
              || '';
            report.transfer.task = {
              httpStatus: taskResult.httpStatus,
              code: taskResult.body?.code,
              status: taskResult.body?.status,
              dataKeys: Object.keys(taskResult.body?.data || {}),
              completed: Boolean(savedFid)
            };
          }
        }

        if (savedFid) {
          const playResult = await requestJson(`${driveBase}/file/v2/play?pr=ucpro&fr=pc`, {
            method: 'POST',
            body: JSON.stringify({
              fid: savedFid,
              resolutions: 'normal,low,high,super,2k,4k',
              supports: 'fmp4,m3u8'
            })
          });
          report.transfer.play = {
            httpStatus: playResult.httpStatus,
            code: playResult.body?.code,
            status: playResult.body?.status,
            message: playResult.body?.message || playResult.body?.message_desc,
            dataKeys: Object.keys(playResult.body?.data || {}),
            sample: redact(playResult.body?.data || {})
          };
        }
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}
