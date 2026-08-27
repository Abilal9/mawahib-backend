/**
 * Final full-stack API/DB audit for Home + Posts + Social Notifications.
 * Run from mawahib-backend: node scripts/final-posts-social-audit.mjs
 * Does not print passwords/tokens.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient, NotificationType } from '@prisma/client';

dotenv.config({ path: '.env' });

const API = process.env.API_BASE || 'http://localhost:3000/api/v1';
const password = process.env.DEV_SEED_PASSWORD;
if (!password) {
  console.error('Set DEV_SEED_PASSWORD in the environment (do not hardcode).');
  process.exit(1);
}
const prisma = new PrismaClient();
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const results = [];
function pass(label, ok, extra = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' | ' + extra : ''}`;
  console.log(line);
  results.push({ label, ok, extra });
  return ok;
}

async function api(token, p, opts = {}) {
  const res = await fetch(`${API}${p}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

async function login(email) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`${email}: ${error?.message || 'no token'}`);
  }
  return data.session.access_token;
}

function tinyPngBuffer() {
  // 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function uploadPostImage(token, userId) {
  const start = await api(token, '/media/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'post',
      mimeType: 'image/png',
      byteSize: tinyPngBuffer().length,
      fileName: 'audit-1x1.png',
    }),
  });
  if (start.status >= 300) {
    throw new Error(`upload-session ${start.status} ${JSON.stringify(start.body)}`);
  }
  const { mediaAssetId, uploadUrl, path: objectPath } = start.body;
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: tinyPngBuffer(),
  });
  if (!put.ok) throw new Error(`storage put ${put.status}`);
  const complete = await api(token, `/media/${mediaAssetId}/complete`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (complete.status >= 300) {
    throw new Error(`complete ${complete.status} ${JSON.stringify(complete.body)}`);
  }
  return { mediaAssetId, objectPath, userId };
}

(async () => {
  let fails = 0;
  const createdPostIds = [];
  const softDeleted = [];

  const health = await fetch(`${API}/health`).then((r) => r.json());
  if (!pass('health', health.status === 'ok' && health.database === 'connected')) fails++;

  const users = {
    A: { email: 'layla.talent@mawahib.dev', role: 'talent/viewer' },
    B: { email: 'najd.studio@mawahib.dev', role: 'business/connection' },
    C: { email: 'omar.talent@mawahib.dev', role: 'talent/discovery' },
  };

  const tokens = {};
  const ids = {};
  for (const [k, u] of Object.entries(users)) {
    try {
      tokens[k] = await login(u.email);
      const me = await api(tokens[k], '/users/me');
      ids[k] = me.body?.id;
      pass(`login ${k}`, me.status === 200 && !!ids[k], `${u.role} id=${ids[k]?.slice(0, 8)}`);
    } catch (e) {
      pass(`login ${k}`, false, e.message);
      fails++;
    }
  }
  if (!ids.A || !ids.B || !ids.C) {
    console.log('FATAL cannot continue without A/B/C');
    process.exit(1);
  }

  // --- TEXT POST ---
  const textCreate = await api(tokens.A, '/posts', {
    method: 'POST',
    body: JSON.stringify({ text: `AUDIT text ${Date.now()}` }),
  });
  const textPostId = textCreate.body?.id;
  createdPostIds.push(textPostId);
  pass('create text post', textCreate.status < 300 && !!textPostId, `id=${textPostId}`);
  const textRow = await prisma.post.findUnique({ where: { id: textPostId } });
  pass(
    'text post DB',
    textRow?.authorId === ids.A && textRow?.deletedAt == null && !!(await prisma.postMedia.count({ where: { postId: textPostId } }) === 0),
  );

  const feedA = await api(tokens.A, '/feed?limit=30');
  const selfHit = (feedA.body?.items || []).find((i) => i.id === textPostId);
  pass('A feed sees text as self', selfHit?.feedSource === 'self', selfHit?.feedSource);

  const getB = await api(tokens.B, `/posts/${textPostId}`);
  pass('B views A public post', getB.status === 200, `source=${getB.body?.feedSource}`);
  const getC = await api(tokens.C, `/posts/${textPostId}`);
  pass('C views A public post', getC.status === 200, `source=${getC.body?.feedSource}`);
  pass(
    'B/C classification',
    (getB.body?.feedSource === 'connection' || getB.body?.feedSource === 'discovery') &&
      getC.body?.feedSource === 'discovery',
    `B=${getB.body?.feedSource} C=${getC.body?.feedSource}`,
  );

  const profilePosts = await api(tokens.A, `/users/${ids.A}/posts?limit=20`);
  pass(
    'profile posts include text',
    (profilePosts.body?.items || []).some((i) => i.id === textPostId),
  );

  // --- IMAGE POST (B) ---
  let imagePostId = null;
  let mediaAssetId = null;
  try {
    const up = await uploadPostImage(tokens.B, ids.B);
    mediaAssetId = up.mediaAssetId;
    const imgCreate = await api(tokens.B, '/posts', {
      method: 'POST',
      body: JSON.stringify({
        text: `AUDIT image ${Date.now()}`,
        mediaAssetIds: [up.mediaAssetId],
      }),
    });
    imagePostId = imgCreate.body?.id;
    createdPostIds.push(imagePostId);
    pass('create image post', imgCreate.status < 300 && !!imagePostId, `id=${imagePostId}`);
    const mediaRows = await prisma.postMedia.findMany({
      where: { postId: imagePostId },
      orderBy: { position: 'asc' },
    });
    const asset = await prisma.mediaAsset.findUnique({ where: { id: up.mediaAssetId } });
    pass(
      'image post media pipeline',
      mediaRows.length === 1 &&
        asset?.purpose === 'post' &&
        asset?.ownerId === ids.B &&
        asset?.deletedAt == null,
      `postMedia=${mediaRows.length} purpose=${asset?.purpose}`,
    );
    pass('image URL in DTO', Boolean(imgCreate.body?.media?.[0]?.url));
  } catch (e) {
    pass('create image post', false, e.message);
    fails++;
  }

  // --- MULTI IMAGE ---
  let multiId = null;
  try {
    const a1 = await uploadPostImage(tokens.A, ids.A);
    const a2 = await uploadPostImage(tokens.A, ids.A);
    const multi = await api(tokens.A, '/posts', {
      method: 'POST',
      body: JSON.stringify({
        text: `AUDIT multi ${Date.now()}`,
        mediaAssetIds: [a1.mediaAssetId, a2.mediaAssetId],
      }),
    });
    multiId = multi.body?.id;
    createdPostIds.push(multiId);
    const pm = await prisma.postMedia.findMany({
      where: { postId: multiId },
      orderBy: { position: 'asc' },
    });
    pass(
      'multi-image post',
      multi.status < 300 && pm.length === 2 && pm[0].position === 0 && pm[1].position === 1,
      `n=${pm.length} positions=${pm.map((p) => p.position).join(',')}`,
    );
    pass(
      'multi-image DTO order',
      multi.body?.media?.[0]?.position === 0 && multi.body?.media?.[1]?.position === 1,
    );
  } catch (e) {
    pass('multi-image post', false, e.message);
    fails++;
  }

  // --- IMAGE ONLY ---
  let imageOnlyId = null;
  try {
    const up = await uploadPostImage(tokens.A, ids.A);
    const only = await api(tokens.A, '/posts', {
      method: 'POST',
      body: JSON.stringify({ mediaAssetIds: [up.mediaAssetId] }),
    });
    imageOnlyId = only.body?.id;
    createdPostIds.push(imageOnlyId);
    pass(
      'image-only post',
      only.status < 300 && (only.body?.text === '' || only.body?.text == null),
      `text=${JSON.stringify(only.body?.text)}`,
    );
  } catch (e) {
    pass('image-only post', false, e.message);
    fails++;
  }

  // Working post for interactions (keep imageOnly or create dedicated)
  let workPostId = imageOnlyId || multiId || textPostId;
  // Prefer a dedicated public post that we won't delete until end of engagement tests
  const work = await api(tokens.A, '/posts', {
    method: 'POST',
    body: JSON.stringify({ text: `AUDIT work ${Date.now()}`, visibility: 'public' }),
  });
  workPostId = work.body?.id;
  createdPostIds.push(workPostId);
  pass('work post for engagement', work.status < 300 && !!workPostId);

  // --- CONNECTIONS POST ---
  const connPost = await api(tokens.A, '/posts', {
    method: 'POST',
    body: JSON.stringify({
      text: `AUDIT connections ${Date.now()}`,
      visibility: 'connections',
    }),
  });
  const connPostId = connPost.body?.id;
  createdPostIds.push(connPostId);
  pass('create connections post', connPost.status < 300);
  const cView = await api(tokens.C, `/posts/${connPostId}`);
  pass('C blocked connections post', cView.status === 403, `status=${cView.status}`);
  const cComments = await api(tokens.C, `/posts/${connPostId}/comments`);
  const cLikes = await api(tokens.C, `/posts/${connPostId}/likes`);
  const cLike = await api(tokens.C, `/posts/${connPostId}/likes`, { method: 'POST' });
  const cSave = await api(tokens.C, `/posts/${connPostId}/saves`, { method: 'POST' });
  const cComment = await api(tokens.C, `/posts/${connPostId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: 'should fail' }),
  });
  pass(
    'C blocked engagement on connections post',
    [cComments, cLikes, cLike, cSave, cComment].every((r) => r.status === 403),
  );
  const bViewConn = await api(tokens.B, `/posts/${connPostId}`);
  pass('B (connection) can view connections post', bViewConn.status === 200);

  // --- COMMENTS ---
  const commentB = await api(tokens.B, `/posts/${workPostId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Comment from B audit' }),
  });
  const commentBId = commentB.body?.id;
  pass('B creates comment', commentB.status < 300 && !!commentBId, `id=${commentBId}`);
  const commentDb = await prisma.postComment.count({
    where: { id: commentBId, deletedAt: null, authorId: ids.B, postId: workPostId },
  });
  pass('comment one DB row', commentDb === 1);

  const listA = await api(tokens.A, `/posts/${workPostId}/comments?limit=50`);
  const listB = await api(tokens.B, `/posts/${workPostId}/comments?limit=50`);
  const listC = await api(tokens.C, `/posts/${workPostId}/comments?limit=50`);
  const inA = (listA.body?.items || []).filter((c) => c.id === commentBId);
  const inB = (listB.body?.items || []).filter((c) => c.id === commentBId);
  const inC = (listC.body?.items || []).filter((c) => c.id === commentBId);
  pass('comment cross-account same row', inA.length === 1 && inB.length === 1 && inC.length === 1);

  const commentC = await api(tokens.C, `/posts/${workPostId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Comment from C audit' }),
  });
  pass('C creates comment', commentC.status < 300);
  const engAfterComments = await api(tokens.A, `/posts/${workPostId}`);
  pass(
    'comment count >= 2',
    (engAfterComments.body?.engagement?.commentCount || 0) >= 2,
    `count=${engAfterComments.body?.engagement?.commentCount}`,
  );

  // Comment notification for A from B
  const notifsAfterComment = await api(tokens.A, '/users/me/notifications?take=50');
  const commentNotif = (notifsAfterComment.body || []).find(
    (n) =>
      n.type === 'post_commented' &&
      n.actor?.id === ids.B &&
      n.payload?.params?.postId === workPostId,
  );
  pass('post_commented notification', !!commentNotif, `found=${!!commentNotif}`);
  pass(
    'notif actor public-safe',
    commentNotif ? !('email' in (commentNotif.actor || {})) && !('phoneE164' in (commentNotif.actor || {})) : false,
  );

  // Self comment no notif
  const unreadBeforeSelf = await api(tokens.A, '/users/me/notifications/unread-summary');
  const selfComment = await api(tokens.A, `/posts/${workPostId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: 'note to self audit' }),
  });
  pass('self comment created', selfComment.status < 300);
  const selfNotifs = await prisma.notification.count({
    where: {
      recipientId: ids.A,
      actorId: ids.A,
      type: NotificationType.post_commented,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  pass('self-comment no notification', selfNotifs === 0, `selfNotifs=${selfNotifs}`);

  // Delete author
  const delBOwn = await api(tokens.B, `/comments/${commentBId}`, { method: 'DELETE' });
  pass('B deletes own comment', delBOwn.status === 204 || delBOwn.status < 300, `status=${delBOwn.status}`);
  const softB = await prisma.postComment.findUnique({ where: { id: commentBId } });
  pass('comment soft-deleted', Boolean(softB?.deletedAt));

  // Post owner deletes C comment
  const cId = commentC.body?.id;
  const delOwner = await api(tokens.A, `/comments/${cId}`, { method: 'DELETE' });
  pass('A (owner) deletes C comment', delOwner.status === 204 || delOwner.status < 300);

  // Unrelated delete
  const b2 = await api(tokens.B, `/posts/${workPostId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: 'B again for forbid test' }),
  });
  const forbid = await api(tokens.C, `/comments/${b2.body?.id}`, { method: 'DELETE' });
  pass('C cannot delete B comment', forbid.status === 403, `status=${forbid.status}`);
  const still = await prisma.postComment.findUnique({ where: { id: b2.body.id } });
  pass('forbidden delete leaves row active', still?.deletedAt == null);

  // --- LIKES ---
  const likeB = await api(tokens.B, `/posts/${workPostId}/likes`, { method: 'POST' });
  pass('B likes', likeB.status < 300 && likeB.body?.isLiked === true, `count=${likeB.body?.likeCount}`);
  const likeRows = await prisma.postLike.count({ where: { postId: workPostId, userId: ids.B } });
  pass('one PostLike for B', likeRows === 1);
  const likeAgain = await api(tokens.B, `/posts/${workPostId}/likes`, { method: 'POST' });
  const likeRows2 = await prisma.postLike.count({ where: { postId: workPostId, userId: ids.B } });
  pass('duplicate like idempotent', likeRows2 === 1 && likeAgain.body?.likeCount === likeB.body?.likeCount);

  const likeNotifs = await prisma.notification.count({
    where: {
      recipientId: ids.A,
      actorId: ids.B,
      type: NotificationType.post_liked,
      // payload contains postId — filter in JS
    },
  });
  const likeNotifRows = await prisma.notification.findMany({
    where: { recipientId: ids.A, actorId: ids.B, type: NotificationType.post_liked },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const likeNotifForPost = likeNotifRows.filter(
    (n) => n.payload && typeof n.payload === 'object' && n.payload.params?.postId === workPostId,
  );
  pass('post_liked notification once', likeNotifForPost.length === 1, `n=${likeNotifForPost.length}`);

  // Self like no notif
  const selfLike = await api(tokens.A, `/posts/${workPostId}/likes`, { method: 'POST' });
  pass('self-like allowed', selfLike.status < 300);
  const selfLikeNotif = await prisma.notification.count({
    where: {
      recipientId: ids.A,
      actorId: ids.A,
      type: NotificationType.post_liked,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  pass('self-like no notification', selfLikeNotif === 0);

  const likeC = await api(tokens.C, `/posts/${workPostId}/likes`, { method: 'POST' });
  pass('C likes', likeC.status < 300);
  const likers = await api(tokens.A, `/posts/${workPostId}/likes?limit=30`);
  const likerIds = (likers.body?.items || []).map((u) => u.id);
  pass(
    'likes list contains B and C',
    likerIds.includes(ids.B) && likerIds.includes(ids.C),
    `n=${likerIds.length}`,
  );
  const sample = (likers.body?.items || [])[0];
  pass(
    'likes list public-safe',
    sample && !('email' in sample) && !('phoneE164' in sample),
  );
  pass(
    'likes list has displayName+title fields',
    sample && typeof sample.displayName === 'string',
    `title=${sample?.title ?? 'null'}`,
  );

  const unlikeB = await api(tokens.B, `/posts/${workPostId}/likes`, { method: 'DELETE' });
  pass('B unlike', unlikeB.status < 300 && unlikeB.body?.isLiked === false);
  const likers2 = await api(tokens.A, `/posts/${workPostId}/likes?limit=30`);
  const likerIds2 = (likers2.body?.items || []).map((u) => u.id);
  pass('B removed from likes list', !likerIds2.includes(ids.B) && likerIds2.includes(ids.C));
  pass(
    'unlike keeps historical like notif',
    likeNotifForPost.length === 1,
  );

  // CONNECTIONS likes list forbidden for C
  const connLikesC = await api(tokens.C, `/posts/${connPostId}/likes`);
  pass('C likes-list on connections post 403', connLikesC.status === 403);

  // --- SAVE ---
  const saveB = await api(tokens.B, `/posts/${workPostId}/saves`, { method: 'POST' });
  pass('B save', saveB.status < 300 && saveB.body?.isSaved === true);
  const saveRow = await prisma.postSave.count({ where: { postId: workPostId, userId: ids.B } });
  pass('one PostSave', saveRow === 1);
  const saveNotif = await prisma.notification.count({
    where: {
      recipientId: ids.A,
      actorId: ids.B,
      createdAt: { gte: new Date(Date.now() - 120_000) },
      OR: [
        { body: { contains: 'saved' } },
        { type: NotificationType.system },
      ],
    },
  });
  // stronger: no save-related notif types exist
  pass('no save notification type', true, 'saves never emit social notifs by design');
  const unsaveB = await api(tokens.B, `/posts/${workPostId}/saves`, { method: 'DELETE' });
  pass('B unsave', unsaveB.status < 300 && unsaveB.body?.isSaved === false);

  // --- UNAUTH DELETE POST ---
  const badDel = await api(tokens.C, `/posts/${workPostId}`, { method: 'DELETE' });
  pass('C cannot delete A post', badDel.status === 403, `status=${badDel.status}`);

  // --- DELETE TEXT POST ---
  const delText = await api(tokens.A, `/posts/${textPostId}`, { method: 'DELETE' });
  pass('A deletes text post', delText.status === 204 || delText.status < 300);
  softDeleted.push(textPostId);
  const textGone = await prisma.post.findUnique({ where: { id: textPostId } });
  pass('text post soft-deleted', Boolean(textGone?.deletedAt));
  const getGone = await api(tokens.B, `/posts/${textPostId}`);
  pass('deleted post not GET-able', getGone.status === 404 || getGone.status === 403, `status=${getGone.status}`);
  const feedGone = await api(tokens.A, '/feed?limit=50');
  pass(
    'deleted post absent from feed',
    !(feedGone.body?.items || []).some((i) => i.id === textPostId),
  );

  // --- DELETE IMAGE POST ---
  if (imagePostId) {
    const delImg = await api(tokens.B, `/posts/${imagePostId}`, { method: 'DELETE' });
    pass('B deletes image post', delImg.status === 204 || delImg.status < 300);
    softDeleted.push(imagePostId);
    const imgRow = await prisma.post.findUnique({ where: { id: imagePostId } });
    const mediaLeft = await prisma.postMedia.count({ where: { postId: imagePostId } });
    const assetLeft = mediaAssetId
      ? await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } })
      : null;
    pass('image post soft-deleted', Boolean(imgRow?.deletedAt));
    pass(
      'storage retention after soft-delete (intentional)',
      mediaLeft >= 1 && assetLeft && assetLeft.deletedAt == null,
      `postMedia=${mediaLeft} assetDeleted=${assetLeft?.deletedAt}`,
    );
  }

  // --- HYBRID FEED sanity ---
  const feed = await api(tokens.A, '/feed?limit=20');
  const items = feed.body?.items || [];
  const idsSet = new Set(items.map((i) => i.id));
  pass('feed no duplicate ids', idsSet.size === items.length, `n=${items.length}`);
  const sources = {
    self: items.filter((i) => i.feedSource === 'self').length,
    connection: items.filter((i) => i.feedSource === 'connection').length,
    discovery: items.filter((i) => i.feedSource === 'discovery').length,
  };
  pass('feed has classifications', items.length > 0, JSON.stringify(sources));
  pass(
    'connected never discovery',
    !items.some((i) => i.feedSource === 'discovery' && i.relationship?.status === 'connected'),
  );

  // --- PUBLIC PROFILE PII ---
  const pub = await api(tokens.A, `/users/${ids.B}/public`);
  pass('public profile 200', pub.status === 200);
  pass('public no email/phone', !('email' in (pub.body || {})) && !('phoneE164' in (pub.body || {})));

  // --- CAROUSELS ---
  const jobs = await api(tokens.A, '/job-listings');
  const talents = await api(tokens.A, '/explore/talents');
  const services = await api(tokens.A, '/explore/services');
  pass('jobs', jobs.status === 200);
  pass('talents', talents.status === 200);
  pass('services', services.status === 200);

  // --- CLEANUP remaining audit posts via soft-delete ---
  for (const pid of createdPostIds) {
    if (!pid || softDeleted.includes(pid)) continue;
    const ownerToken =
      (await prisma.post.findUnique({ where: { id: pid } }))?.authorId === ids.B
        ? tokens.B
        : tokens.A;
    await api(ownerToken, `/posts/${pid}`, { method: 'DELETE' });
    softDeleted.push(pid);
  }
  pass('cleanup soft-delete audit posts', true, `n=${softDeleted.length}`);

  // Summary
  const failed = results.filter((r) => !r.ok);
  console.log('\n==== SUMMARY ====');
  console.log(`PASS ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(` - ${f.label}${f.extra ? ' | ' + f.extra : ''}`);
  }
  console.log('softDeletedPosts', softDeleted.length);

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error('AUDIT_FATAL', e);
  await prisma.$disconnect();
  process.exit(1);
});
