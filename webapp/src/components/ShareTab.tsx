import { useState, useCallback, useRef, memo, useEffect } from 'react';
import { useToast } from './Toast';

interface UploadedFile {
  name: string;
  size: number;
  url: string;
  viewerUrl: string;
  uploadedAt: Date;
  sessionId?: string;
}


// Generate a random session ID for grouping files
const generateSessionId = () => {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
};

export const ShareTab = memo(() => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [currentFileName, setCurrentFileName] = useState('');
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [targetProgress, setTargetProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number | null>(null);
  const { showToast } = useToast();

  // Smooth animation for progress bar
  useEffect(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = () => {
      setDisplayProgress(prev => {
        const diff = targetProgress - prev;
        // If we're resetting (going from high to 0), snap immediately
        if (targetProgress === 0 && prev > 50) {
          return 0;
        }
        // Smooth animation toward target
        if (Math.abs(diff) < 0.5) {
          return targetProgress;
        }
        // Faster when catching up, slower when close
        const speed = Math.max(0.5, Math.abs(diff) * 0.15);
        return prev + (diff > 0 ? speed : -speed);
      });
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetProgress]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const uploadFile = async (file: File, sessionId: string, onProgress: (percent: number) => void): Promise<UploadedFile> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', sessionId);

      const xhr = new XMLHttpRequest();
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // Track upload progress - cap at 99% until server responds
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        settle(() => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              const viewerUrl = data.viewerUrl
                ? `${window.location.origin}${data.viewerUrl}`
                : data.url;
              resolve({
                name: file.name,
                size: file.size,
                url: data.url,
                viewerUrl,
                uploadedAt: new Date(),
                sessionId,
              });
            } catch {
              reject(new Error('Invalid response from server'));
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              reject(new Error(errorData.error || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        });
      };

      xhr.onerror = () => {
        settle(() => reject(new Error('Network error - check your connection')));
      };

      xhr.ontimeout = () => {
        settle(() => reject(new Error('Upload timed out')));
      };

      xhr.onabort = () => {
        settle(() => reject(new Error('Upload was cancelled')));
      };

      // 10 minute timeout for large files on mobile
      xhr.timeout = 10 * 60 * 1000;

      // Upload directly to API server to bypass Vercel's 4.5MB proxy limit
      const apiUrl = window.location.hostname === 'localhost'
        ? '/api/share/upload'
        : 'https://shelby.cash.trading/api/share/upload';

      xhr.open('POST', apiUrl);
      xhr.send(formData);
    });
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    // Filter valid files first
    const validFiles = Array.from(files).filter(file => {
      if (file.size > 2 * 1024 * 1024 * 1024) {
        showToast({
          type: 'error',
          message: `${file.name} is too large (max 2GB)`
        });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setError(null);
    setIsUploading(true);
    setTotalFiles(validFiles.length);
    setCurrentFileIndex(0);
    setTargetProgress(0);
    setDisplayProgress(0);

    // Generate a new session ID for this batch
    const sessionId = generateSessionId();
    setCurrentSessionId(sessionId);

    const newFiles: UploadedFile[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];

        // Reset progress for each file
        setCurrentFileIndex(i + 1);
        setCurrentFileName(file.name);
        setTargetProgress(0);
        setDisplayProgress(0);

        // Small delay to ensure UI updates before starting upload
        await new Promise(r => setTimeout(r, 100));

        try {
          const uploaded = await uploadFile(file, sessionId, (percent) => {
            setTargetProgress(percent);
          });

          // Animate to 100%
          setTargetProgress(100);

          // Wait for animation to reach 100%
          await new Promise(r => setTimeout(r, 500));

          newFiles.push(uploaded);
          showToast({ type: 'success', message: `Uploaded ${file.name}` });

          // Delay before next file
          if (i < validFiles.length - 1) {
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (err) {
          showToast({
            type: 'error',
            message: `Failed: ${file.name}`
          });
          if (i < validFiles.length - 1) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
      }

      if (newFiles.length > 0) {
        setUploadedFiles(prev => [...newFiles, ...prev]);
      }

      // Brief delay before resetting
      await new Promise(r => setTimeout(r, 500));
    } finally {
      setIsUploading(false);
      setTargetProgress(0);
      setDisplayProgress(0);
      setCurrentFileName('');
      setTotalFiles(0);
      setCurrentFileIndex(0);
    }
  }, [showToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFiles]);

  const copyToClipboard = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ type: 'success', message: 'URL copied to clipboard!' });
    } catch {
      showToast({ type: 'error', message: 'Failed to copy URL' });
    }
  }, [showToast]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <column gap-="2" style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <column gap-="1" style={{ textAlign: 'center', padding: '1rem 0' }}>
        <h2 style={{
          margin: 0,
          background: 'linear-gradient(135deg, var(--pink) 0%, var(--purple) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Shelby Share
        </h2>
        <p style={{ color: 'var(--foreground2)', margin: 0, fontSize: '0.9rem' }}>
          Upload files to decentralized storage. No wallet needed.
        </p>
      </column>

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          position: 'relative',
          border: `2px dashed ${isDragging ? 'var(--pink)' : 'var(--background2)'}`,
          borderRadius: '16px',
          padding: '3rem 2rem',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          background: isDragging
            ? 'linear-gradient(135deg, rgba(242, 93, 148, 0.1) 0%, rgba(125, 86, 244, 0.1) 100%)'
            : 'var(--background0)',
          transform: isDragging ? 'scale(1.02)' : 'scale(1)',
        }}
      >
        {/* Upload Button - TUI styled */}
        <button
          is-="button"
          variant-="accent"
          style={{
            position: 'relative',
            margin: '0 auto 1.5rem',
            padding: '1rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '1rem',
            zIndex: 1,
            transform: isDragging ? 'scale(1.05)' : 'scale(1)',
            transition: 'transform 0.2s ease',
          }}
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload
        </button>

        {isUploading ? (() => {
          // ASCII terminal progress bar - wider for better visibility
          const barWidth = 28;
          const progressPercent = Math.round(displayProgress);
          const filled = Math.round((displayProgress / 100) * barWidth);
          const empty = barWidth - filled;
          const bar = '█'.repeat(filled) + '░'.repeat(empty);

          return (
            <div style={{
              width: '100%',
              margin: '0 auto',
              fontFamily: 'monospace',
            }}>
              {/* File counter */}
              {totalFiles > 1 && (
                <div style={{
                  color: 'var(--foreground2)',
                  fontSize: '0.8rem',
                  textAlign: 'center',
                  marginBottom: '0.5rem',
                }}>
                  [{currentFileIndex}/{totalFiles}]
                </div>
              )}

              {/* Current file name */}
              <div style={{
                color: 'var(--foreground0)',
                fontSize: '0.85rem',
                textAlign: 'center',
                marginBottom: '0.75rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {currentFileName}
              </div>

              {/* Terminal ASCII progress bar */}
              <div style={{
                background: 'var(--background0)',
                border: '1px solid var(--background2)',
                padding: '1rem',
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: '1rem',
                  letterSpacing: '0px',
                  color: '#F25D94',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  [{bar}] {progressPercent}%
                </div>
              </div>
            </div>
          );
        })() : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, border: 'none' }}>
            <span style={{
              color: 'var(--foreground0)',
              fontSize: '1.1rem',
              fontWeight: 500,
            }}>
              {isDragging ? 'Drop to upload' : 'Drop files here'}
            </span>
            <span style={{ color: 'var(--foreground2)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              or click to browse
            </span>
            <span style={{ color: 'var(--foreground2)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Images, Videos, PDFs (max 2GB)
            </span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.svg,.pdf,application/pdf"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '0.75rem 1rem',
          background: 'rgba(242, 93, 148, 0.1)',
          border: '1px solid var(--pink)',
          borderRadius: '8px',
          color: 'var(--pink)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}

      {/* Shareable Folder Link */}
      {currentSessionId && uploadedFiles.filter(f => f.sessionId === currentSessionId).length > 0 && (
        <div style={{
          background: 'var(--background1)',
          border: '1px solid var(--background2)',
          borderRadius: '8px',
          padding: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '1rem' }}>📁</span>
              <span style={{ color: 'var(--foreground0)', fontWeight: 500, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                Folder
              </span>
            </div>
            <span is-="badge" variant-="pink" style={{ fontSize: '0.7rem' }}>
              {uploadedFiles.filter(f => f.sessionId === currentSessionId).length} files
            </span>
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}>
            <div style={{
              background: 'var(--background0)',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--background2)',
              fontFamily: 'monospace',
              fontSize: '0.65rem',
              color: 'var(--foreground2)',
              wordBreak: 'break-all',
            }}>
              {`${window.location.origin}/api/share/folder/${currentSessionId}`}
            </div>
            <button
              is-="button"
              variant-="accent"
              onClick={() => copyToClipboard(`${window.location.origin}/api/share/folder/${currentSessionId}`)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', width: '100%', padding: '0.5rem' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Folder Link
            </button>
          </div>
        </div>
      )}

      {/* Uploaded Files */}
      {uploadedFiles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--foreground0)', fontWeight: 500, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              ▸ Uploaded Files
            </span>
            <span is-="badge" variant-="background2" style={{ fontSize: '0.7rem' }}>
              {uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {uploadedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                style={{
                  background: 'var(--background0)',
                  border: '1px solid var(--background2)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                }}
              >
                {/* File name and size */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{
                    color: 'var(--foreground0)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {file.name}
                  </div>
                  <div style={{ color: 'var(--foreground2)', fontSize: '0.7rem' }}>
                    {formatFileSize(file.size)}
                  </div>
                </div>

                {/* URL display */}
                <div style={{
                  padding: '0.4rem',
                  background: 'var(--background1)',
                  borderRadius: '4px',
                  fontSize: '0.6rem',
                  fontFamily: 'monospace',
                  color: 'var(--foreground2)',
                  wordBreak: 'break-all',
                  marginBottom: '0.5rem',
                }}>
                  {file.viewerUrl}
                </div>

                {/* Buttons - full width on mobile */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <a
                    href={file.viewerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    is-="button"
                    variant-="accent"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      textDecoration: 'none',
                      padding: '0.5rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View
                  </a>
                  <button
                    is-="button"
                    variant-="background2"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(file.viewerUrl);
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      padding: '0.5rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </column>
  );
});

ShareTab.displayName = 'ShareTab';
