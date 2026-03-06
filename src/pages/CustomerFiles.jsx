import React, { useCallback, useEffect, useRef, useState } from 'react';
import { downloadProjectFile, listProjectFiles, listProjects, uploadProjectFile } from '../api.js';
import ModalPortal from '../components/ModalPortal.jsx';

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

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.tsv', '.log', '.json', '.yaml', '.yml', '.xml'];
const PDF_EXTENSIONS = ['.pdf'];
const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;

function isImageFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  const name = String(fileRecord?.filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isTextFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type.startsWith('text/')) return true;
  if (
    [
      'application/json',
      'application/xml',
      'application/x-yaml',
      'text/csv',
      'application/vnd.ms-excel'
    ].includes(type)
  ) {
    return true;
  }
  const name = String(fileRecord?.filename || '').toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isPdfFile(fileRecord) {
  const type = String(fileRecord?.content_type || '').toLowerCase();
  if (type === 'application/pdf' || type.includes('/pdf')) return true;
  const name = String(fileRecord?.filename || '').toLowerCase();
  return PDF_EXTENSIONS.some((ext) => name.endsWith(ext));
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

function summarizeSelection(fileList, emptyLabel, noun) {
  if (!fileList.length) return emptyLabel;
  if (fileList.length === 1) return fileList[0].name;
  return `${fileList.length} ${noun} selected`;
}

function getFileTypeLabel(filename) {
  const name = String(filename || '').trim();
  if (!name.includes('.')) return 'FILE';
  const ext = name.split('.').pop();
  if (!ext) return 'FILE';
  return ext.slice(0, 5).toUpperCase();
}

export default function CustomerFiles() {
  const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('success');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState({ open: false, url: '', name: '', kind: '', text: '', record: null });
  const [filePreviewUrls, setFilePreviewUrls] = useState({});
  const filePreviewUrlRef = useRef({});
  const blobCacheRef = useRef(new Map());

  const getCachedBlob = useCallback(async (projectId, fileId) => {
    const key = `${projectId}:${fileId}`;
    const cached = blobCacheRef.current.get(key);
    if (cached) return cached;
    const blob = await downloadProjectFile(projectId, fileId);
    blobCacheRef.current.set(key, blob);
    return blob;
  }, []);

  const replaceFilePreviewUrls = useCallback((nextMap) => {
    const previousMap = filePreviewUrlRef.current || {};
    const nextValues = new Set(Object.values(nextMap));
    Object.values(previousMap).forEach((url) => {
      if (url && !nextValues.has(url)) {
        window.URL.revokeObjectURL(url);
      }
    });
    filePreviewUrlRef.current = nextMap;
    setFilePreviewUrls(nextMap);
  }, []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setStatus('');
    setStatusTone('success');
    setUploadError('');
    try {
      const projects = await listProjects();
      const selected = Array.isArray(projects) && projects.length ? projects[0] : null;
      setProject(selected);
      if (!selected?.id) {
        setFiles([]);
        replaceFilePreviewUrls({});
        return;
      }
      const fileList = await listProjectFiles(selected.id);
      setFiles(Array.isArray(fileList) ? fileList : []);
    } catch (_err) {
      setFiles([]);
      replaceFilePreviewUrls({});
      setStatus('Unable to load project files.');
      setStatusTone('error');
    } finally {
      setLoading(false);
    }
  }, [replaceFilePreviewUrls]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

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
    const loadPreviews = async () => {
      if (!project?.id || !files.length) {
        replaceFilePreviewUrls({});
        return;
      }
      const imageFiles = files.filter((item) => isImageFile(item));
      if (!imageFiles.length) {
        replaceFilePreviewUrls({});
        return;
      }
      const entries = await Promise.all(
        imageFiles.map(async (fileRecord) => {
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
      replaceFilePreviewUrls(nextMap);
    };

    loadPreviews();
    return () => {
      cancelled = true;
    };
  }, [files, project?.id, replaceFilePreviewUrls, getCachedBlob]);

  const handleView = async (fileRecord) => {
    if (!project?.id || !fileRecord?.id) return;
    setStatus('');
    setStatusTone('success');
    const name = fileRecord.filename || 'File preview';
    setPreview({ open: true, url: '', name, kind: 'loading', text: '', record: fileRecord });
    setPreviewLoading(true);
    try {
      const blob = await getCachedBlob(project.id, fileRecord.id);
      if (isImageFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'image', text: '', record: fileRecord });
        return;
      }
      if (isTextFile(fileRecord)) {
        const isTruncated = blob.size > TEXT_PREVIEW_LIMIT_BYTES;
        const textBlob = isTruncated ? blob.slice(0, TEXT_PREVIEW_LIMIT_BYTES) : blob;
        const text = await textBlob.text();
        setPreview({ open: true, url: '', name, kind: 'text', text, record: fileRecord });
        if (isTruncated) {
          setStatus('Showing partial text preview (first 1 MB). Download for full file.');
          setStatusTone('success');
        }
        return;
      }
      if (isPdfFile(fileRecord)) {
        const url = window.URL.createObjectURL(blob);
        setPreview({ open: true, url, name, kind: 'pdf', text: '', record: fileRecord });
        return;
      }
      setPreview({ open: false, url: '', name: '', kind: '', text: '', record: null });
      setStatus('Preview unavailable for this file type. Use Download.');
      setStatusTone('error');
    } catch (_err) {
      setPreview({ open: false, url: '', name: '', kind: '', text: '', record: null });
      setStatus('Unable to open file.');
      setStatusTone('error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (fileRecord) => {
    if (!project?.id || !fileRecord?.id) return;
    setStatus('');
    setStatusTone('success');
    try {
      const blob = await getCachedBlob(project.id, fileRecord.id);
      triggerBrowserDownload(blob, fileRecord.filename);
    } catch (_err) {
      setStatus('Unable to download file.');
      setStatusTone('error');
    }
  };

  const closePreview = () => {
    if (preview.url) {
      window.URL.revokeObjectURL(preview.url);
    }
    setPreviewLoading(false);
    setPreview({ open: false, url: '', name: '', kind: '', text: '', record: null });
  };

  useEffect(() => {
    return () => {
      if (preview.url) {
        window.URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview.url]);

  useEffect(() => {
    return () => {
      const map = filePreviewUrlRef.current || {};
      Object.values(map).forEach((url) => {
        if (url) window.URL.revokeObjectURL(url);
      });
      filePreviewUrlRef.current = {};
      blobCacheRef.current.clear();
    };
  }, []);

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!project?.id) return;
    if (!uploadFiles.length) {
      setUploadError('Select files to upload.');
      return;
    }
    setUploading(true);
    setUploadError('');
    setStatus('');
    setStatusTone('success');
    try {
      for (const file of uploadFiles) {
        await uploadProjectFile(project.id, file, {
          filename: file.name,
          customer_visible: true,
          content_type: file.type || undefined
        });
      }
      const uploadedCount = uploadFiles.length;
      setUploadFiles([]);
      await loadFiles();
      setStatus(uploadedCount === 1 ? 'File uploaded.' : `${uploadedCount} files uploaded.`);
      setStatusTone('success');
    } catch (err) {
      setUploadError(err?.message || 'Unable to upload file.');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (dropped.length) setUploadFiles(dropped);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Files</h2>
          <p className="muted">Project documents shared with you. Your uploads will be shared with the project team.</p>
        </div>
        <button className="ghost" type="button" onClick={loadFiles} disabled={loading}>
          Refresh
        </button>
      </div>
      {status ? <div className={statusTone === 'error' ? 'alert' : 'status-banner success'}>{status}</div> : null}
      {loading ? <p className="muted">Loading files...</p> : null}
      {!project ? (
        <div className="empty-state">
          <p className="muted">No project linked yet.</p>
        </div>
      ) : (
        <>
          <form className="file-upload-form" onSubmit={handleUpload}>
            <input
              id="customer-file-upload"
              className="file-upload-input"
              type="file"
              multiple
              onChange={(event) => setUploadFiles(Array.from(event.target.files || []))}
            />
            <div
              className={`file-upload-row${dragActive ? ' drag-active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              <div className="file-drop-hint">
                <span className="file-drop-icon" aria-hidden="true">+</span>
                <span>{dragActive ? 'Drop files to upload' : 'Drag and drop files here'}</span>
              </div>
              <span className="file-upload-name">
                {summarizeSelection(uploadFiles, 'Upload signed documents here', 'files')}
              </span>
            </div>
            <div className="file-upload-actions">
              <div className="file-upload-controls">
                <label htmlFor="customer-file-upload" className="ghost file-upload-button">
                  Choose files
                </label>
                <button className="primary" type="submit" disabled={!uploadFiles.length || uploading}>
                  {uploading ? 'Uploading...' : 'Upload documents'}
                </button>
              </div>
              <span className="file-upload-selected">
                {summarizeSelection(uploadFiles, 'No files selected', 'files')}
              </span>
            </div>
            <div className="file-upload-actions">
              <span className="muted">Uploaded files are shared with the project team.</span>
            </div>
            <div>
              {uploadError ? <div className="alert">{uploadError}</div> : null}
            </div>
          </form>
          <div className="photo-gallery-panel">
            {files.length ? (
              <div className="photo-gallery">
                {files.map((fileRecord) => (
                  <button
                    key={fileRecord.id}
                    type="button"
                    className="photo-card file-card"
                    onClick={() => handleView(fileRecord)}
                  >
                    <div className="photo-thumb-wrap file-thumb-wrap">
                      {isImageFile(fileRecord) ? (
                        filePreviewUrls[fileRecord.id] ? (
                          <img className="photo-thumb" src={filePreviewUrls[fileRecord.id]} alt={fileRecord.filename} />
                        ) : (
                          <div className="photo-thumb-placeholder">Loading...</div>
                        )
                      ) : (
                        <div className="file-thumb-placeholder">
                          <span className="file-thumb-type">{getFileTypeLabel(fileRecord.filename)}</span>
                        </div>
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
                <p className="muted">No files uploaded yet.</p>
              </div>
            )}
          </div>
        </>
      )}

      {preview.open ? (
        <ModalPortal>
          <div className="modal-backdrop preview-backdrop" onClick={closePreview}>
            <div className="modal file-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">{preview.name}</div>
                <div className="file-preview-header-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => preview.record && handleDownload(preview.record)}
                    disabled={!preview.record}
                  >
                    Download
                  </button>
                  <button className="ghost" type="button" onClick={closePreview}>
                    Close
                  </button>
                </div>
              </div>
              <div className="file-preview-body">
                {previewLoading || preview.kind === 'loading' ? (
                  <div className="file-preview-loading">
                    <div className="file-preview-spinner" aria-hidden="true" />
                    <p>Opening file preview...</p>
                  </div>
                ) : preview.kind === 'image' ? (
                  <img src={preview.url} alt={preview.name} />
                ) : preview.kind === 'text' ? (
                  <pre className="file-preview-text">{preview.text || 'No preview available.'}</pre>
                ) : preview.kind === 'pdf' ? (
                  <object className="file-preview-frame" data={preview.url} type="application/pdf">
                    <div className="file-preview-fallback">
                      Preview unavailable. Use download to open this file.
                    </div>
                  </object>
                ) : (
                  <div className="file-preview-fallback">Preview unavailable for this file type.</div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  );
}
