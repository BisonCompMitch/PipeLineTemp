import React, { useCallback, useEffect, useRef, useState } from 'react';
import { downloadProjectFile, listProjectFiles } from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';
import FileViewToggle from '../components/FileViewToggle.jsx';
import useSiteDialog from '../utils/useSiteDialog.jsx';
import useFileViewMode from '../utils/useFileViewMode.js';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic'];

function isImageFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(fileRecord?.filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function triggerBrowserDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

export default function CustomerPictures({ project, loadingProjects = false, audience = 'customer' }) {
  const [photos, setPhotos] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const photoUrlRef = useRef({});
  const blobCacheRef = useRef(new Map());
  const [reloadToken, setReloadToken] = useState(0);
  const { alertDialog, dialogPortal } = useSiteDialog();
  const [fileViewMode, setFileViewMode] = useFileViewMode();
  const projectId = project?.id || '';
  const projectName = project?.name || '';
  const isBuilderAudience = audience === 'builder';

  const getCachedBlob = useCallback(async (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const cached = blobCacheRef.current.get(key);
    if (cached) return cached;
    const blob = await downloadProjectFile(projectId, fileId);
    blobCacheRef.current.set(key, blob);
    return blob;
  }, []);

  const replacePhotoUrls = useCallback((nextMap) => {
    const previousMap = photoUrlRef.current || {};
    const nextValues = new Set(Object.values(nextMap));
    Object.values(previousMap).forEach((url) => {
      if (url && !nextValues.has(url)) {
        window.URL.revokeObjectURL(url);
      }
    });
    photoUrlRef.current = nextMap;
    setPhotoUrls(nextMap);
  }, []);

  const loadPhotos = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!projectId) {
        if (!active) return;
        setLoading(false);
        setStatus('');
        setPreviewId(null);
        setPhotos([]);
        replacePhotoUrls({});
        return;
      }
      setLoading(true);
      setStatus('');
      setPreviewId(null);
      setPhotos([]);
      replacePhotoUrls({});
      try {
        const fileList = await listProjectFiles(projectId);
        if (!active) return;
        const filtered = (Array.isArray(fileList) ? fileList : []).filter(isImageFile);
        setPhotos(filtered);
      } catch (_err) {
        if (!active) return;
        setPhotos([]);
        setStatus('Unable to load project pictures.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, reloadToken, replacePhotoUrls]);

  useEffect(() => {
    if (!projectId) {
      blobCacheRef.current.clear();
      return;
    }
    const prefix = `${projectId}:`;
    Array.from(blobCacheRef.current.keys()).forEach((key) => {
      if (!key.startsWith(prefix)) {
        blobCacheRef.current.delete(key);
      }
    });
  }, [projectId]);

  useEffect(() => {
    replacePhotoUrls({});
    setPreviewId(null);
  }, [projectId, replacePhotoUrls]);

  useEffect(() => {
    let cancelled = false;
    const loadThumbnails = async () => {
      if (!projectId || !photos.length) {
        replacePhotoUrls({});
        setThumbLoading(false);
        return;
      }
      setThumbLoading(true);
      const entries = await Promise.all(
        photos.map(async (fileRecord) => {
          if (!fileRecord?.id) return [null, ''];
          try {
            const blob = await getCachedBlob(projectId, fileRecord.id);
            return [fileRecord.id, window.URL.createObjectURL(blob)];
          } catch (_error) {
            return [fileRecord.id, ''];
          }
        })
      );
      if (cancelled) {
        entries.forEach(([, url]) => {
          if (url) window.URL.revokeObjectURL(url);
        });
        setThumbLoading(false);
        return;
      }
      const nextMap = {};
      entries.forEach(([id, url]) => {
        if (id && url) nextMap[id] = url;
      });
      replacePhotoUrls(nextMap);
      setThumbLoading(false);
    };

    loadThumbnails();
    return () => {
      cancelled = true;
    };
  }, [photos, projectId, replacePhotoUrls, getCachedBlob]);

  useEffect(() => {
    if (!previewId) return;
    const exists = photos.some((photo) => photo.id === previewId);
    if (!exists) {
      setPreviewId(null);
    }
  }, [photos, previewId]);

  useEffect(() => {
    return () => {
      const map = photoUrlRef.current || {};
      Object.values(map).forEach((url) => {
        if (url) window.URL.revokeObjectURL(url);
      });
      photoUrlRef.current = {};
      blobCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    let active = true;
    (async () => {
      await alertDialog(status, { title: 'Pictures notice', confirmText: 'OK' });
      if (active) setStatus('');
    })();
    return () => {
      active = false;
    };
  }, [status, alertDialog]);

  const previewPhoto = photos.find((item) => item.id === previewId) || null;
  const previewUrl = previewPhoto ? photoUrls[previewPhoto.id] : '';

  const handleDownloadPreview = async () => {
    if (!projectId || !previewPhoto?.id) return;
    setStatus('');
    try {
      const blob = await getCachedBlob(projectId, previewPhoto.id);
      triggerBrowserDownload(blob, previewPhoto.filename);
    } catch (_error) {
      setStatus('Unable to download file.');
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Project Pictures</h2>
          <p className="muted">
            {isBuilderAudience
              ? projectName
                ? `Builder-visible photos for ${projectName}.`
                : 'Builder-visible photos for the selected project.'
              : projectName
                ? `Customer-visible photos for ${projectName}.`
                : 'Customer-visible photos for the selected project.'}
          </p>
        </div>
        <button className="ghost" type="button" onClick={loadPhotos} disabled={loading || !projectId}>
          Refresh
        </button>
      </div>
      {loadingProjects && !projectId ? <p className="muted">Loading your projects...</p> : null}
      {loading && projectId ? <p className="muted">Loading project pictures...</p> : null}
      {!loadingProjects && !projectId ? (
        <div className="empty-state">
          <p className="muted">No project linked yet.</p>
        </div>
      ) : (
        <div className="photo-gallery-panel">
          {thumbLoading ? <p className="muted">Loading picture gallery...</p> : null}
          {photos.length ? (
            <div className="file-view-toggle-row">
              <FileViewToggle viewMode={fileViewMode} onChange={setFileViewMode} />
            </div>
          ) : null}
          {photos.length ? (
            <div className={`photo-gallery${fileViewMode === 'list' ? ' list-view' : ''}`}>
              {photos.map((fileRecord) => (
                <button
                  key={fileRecord.id}
                  type="button"
                  className="photo-card"
                  onClick={() => setPreviewId(fileRecord.id)}
                  disabled={!photoUrls[fileRecord.id]}
                >
                  <div className="photo-thumb-wrap">
                    {photoUrls[fileRecord.id] ? (
                      <img className="photo-thumb" src={photoUrls[fileRecord.id]} alt={fileRecord.filename} />
                    ) : (
                      <div className="photo-thumb-placeholder">Loading...</div>
                    )}
                  </div>
                  <div className="photo-meta">
                    <div className="photo-name" title={fileRecord.filename}>
                      {fileRecord.filename}
                    </div>
                    <div className="photo-sub muted">
                      <span>{formatDateTime(fileRecord.created_at)}</span>
                      <span>{formatBytes(fileRecord.size_bytes)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p className="muted">
                {isBuilderAudience ? 'No builder-visible pictures shared yet.' : 'No project pictures uploaded yet.'}
              </p>
            </div>
          )}
        </div>
      )}

      {previewPhoto ? (
        <ModalPortal>
          <div className="modal-backdrop preview-backdrop" onClick={() => setPreviewId(null)}>
            <div className="modal file-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">{previewPhoto.filename || 'Photo preview'}</div>
                <div className="file-preview-header-actions">
                  <button className="ghost" type="button" onClick={handleDownloadPreview}>
                    Download
                  </button>
                  <button className="ghost" type="button" onClick={() => setPreviewId(null)}>
                    Close
                  </button>
                </div>
              </div>
              <div className="file-preview-body">
                {previewUrl ? (
                  <img src={previewUrl} alt={previewPhoto.filename || 'Photo preview'} />
                ) : (
                  <div className="file-preview-fallback">Unable to render photo preview.</div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
      {dialogPortal}
    </section>
  );
}
