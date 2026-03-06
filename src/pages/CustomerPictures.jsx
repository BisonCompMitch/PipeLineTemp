import React, { useCallback, useEffect, useRef, useState } from 'react';
import { downloadProjectFile, listProjectFiles, listProjects } from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';

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

export default function CustomerPictures() {
  const [project, setProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const photoUrlRef = useRef({});
  const blobCacheRef = useRef(new Map());

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

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setStatus('');
    setPreviewId(null);
    try {
      const projects = await listProjects();
      const selected = Array.isArray(projects) && projects.length ? projects[0] : null;
      setProject(selected);
      if (!selected?.id) {
        setPhotos([]);
        replacePhotoUrls({});
        return;
      }
      const fileList = await listProjectFiles(selected.id);
      const filtered = (Array.isArray(fileList) ? fileList : []).filter(isImageFile);
      setPhotos(filtered);
    } catch (_err) {
      setPhotos([]);
      setStatus('Unable to load project pictures.');
    } finally {
      setLoading(false);
    }
  }, [replacePhotoUrls]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  useEffect(() => {
    if (!project?.id) {
      blobCacheRef.current.clear();
      return;
    }
    const prefix = `${project.id}:`;
    Array.from(blobCacheRef.current.keys()).forEach((key) => {
      if (!key.startsWith(prefix)) {
        blobCacheRef.current.delete(key);
      }
    });
  }, [project?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadThumbnails = async () => {
      if (!project?.id || !photos.length) {
        replacePhotoUrls({});
        return;
      }
      setThumbLoading(true);
      const entries = await Promise.all(
        photos.map(async (fileRecord) => {
          if (!fileRecord?.id) return [null, ''];
          try {
            const blob = await getCachedBlob(project.id, fileRecord.id);
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
  }, [photos, project?.id, replacePhotoUrls, getCachedBlob]);

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

  const previewPhoto = photos.find((item) => item.id === previewId) || null;
  const previewUrl = previewPhoto ? photoUrls[previewPhoto.id] : '';

  const handleDownloadPreview = async () => {
    if (!project?.id || !previewPhoto?.id) return;
    setStatus('');
    try {
      const blob = await getCachedBlob(project.id, previewPhoto.id);
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
        </div>
        <button className="ghost" type="button" onClick={loadPhotos} disabled={loading}>
          Refresh
        </button>
      </div>
      {status ? <div className="alert">{status}</div> : null}
      {loading ? <p className="muted">Loading project pictures...</p> : null}
      {!project ? (
        <div className="empty-state">
          <p className="muted">No project linked yet.</p>
        </div>
      ) : (
        <div className="photo-gallery-panel">
          {thumbLoading ? <p className="muted">Loading picture gallery...</p> : null}
          {photos.length ? (
            <div className="photo-gallery">
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
              <p className="muted">No project pictures uploaded yet.</p>
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
    </section>
  );
}
