import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [comments, setComments] = useState([])
  const [suggestions, setSuggestions] = useState({})
  
  // Dashboard Tabs & Pending Suggestions State
  const [activeTab, setActiveTab] = useState('pending')
  const [pendingSuggestions, setPendingSuggestions] = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [watchedRepos, setWatchedRepos] = useState([])
  
  // OAuth Token State
  const [token, setToken] = useState(null)
  
  // Cascading Dropdowns State
  const [repos, setRepos] = useState([])
  const [selectedRepo, setSelectedRepo] = useState({ owner: '', repo: '' })
  const [pullRequests, setPullRequests] = useState([])
  const [selectedPR, setSelectedPR] = useState('')
  
  // Loading states
  const [loadingComments, setLoadingComments] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loadingPRs, setLoadingPRs] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  // Handle OAuth Token on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    if (urlToken) {
      setToken(urlToken)
      // Clean query parameters from URL bar
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  // Fetch repositories once token is available
  useEffect(() => {
    if (!token) {
      setRepos([])
      setSelectedRepo({ owner: '', repo: '' })
      return
    }
    
    const fetchRepos = async () => {
      setLoadingRepos(true)
      try {
        const response = await fetch('http://localhost:8000/repos', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        const data = await response.json()
        setRepos(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error(e)
        setRepos([])
      } finally {
        setLoadingRepos(false)
      }
    }
    
    fetchRepos()
  }, [token])

  const fetchWatchedRepos = async () => {
    if (!token) return
    try {
      const response = await fetch('http://localhost:8000/repos/watched', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      const data = await response.json()
      setWatchedRepos(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (token) {
      fetchWatchedRepos()
    } else {
      setWatchedRepos([])
    }
  }, [token])

  // Fetch open PRs once selected repository changes
  useEffect(() => {
    if (!selectedRepo.owner || !selectedRepo.repo) {
      setPullRequests([])
      setSelectedPR('')
      return
    }

    const fetchPRs = async () => {
      setLoadingPRs(true)
      try {
        const response = await fetch(
          `http://localhost:8000/repos/${selectedRepo.owner}/${selectedRepo.repo}/pulls`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        )
        const data = await response.json()
        setPullRequests(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error(e)
        setPullRequests([])
      } finally {
        setLoadingPRs(false)
      }
    }

    fetchPRs()
  }, [selectedRepo, token])

  const handleRepoChange = (e) => {
    const fullName = e.target.value
    if (!fullName) {
      setSelectedRepo({ owner: '', repo: '' })
      setSelectedPR('')
      setPullRequests([])
      return
    }
    const [ownerPart, repoPart] = fullName.split('/')
    setSelectedRepo({ owner: ownerPart, repo: repoPart })
    setSelectedPR('')
  }

  const handleWatchToggle = async () => {
    const { owner, repo } = selectedRepo
    if (!owner || !repo) return

    const isWatched = watchedRepos.some(
      (w) => w.owner.toLowerCase() === owner.toLowerCase() && w.repo.toLowerCase() === repo.toLowerCase()
    )

    const url = `http://localhost:8000/repos/${owner}/${repo}/watch`
    const method = isWatched ? 'DELETE' : 'POST'

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.error) {
        alert(`Failed: ${data.error}`)
        return
      }
      fetchWatchedRepos()
    } catch (e) {
      console.error(e)
      alert('Error updating watch status')
    }
  }

  const handlePRChange = (e) => {
    setSelectedPR(e.target.value)
  }

  const fetchComments = async () => {
    const { owner, repo } = selectedRepo
    if (!owner || !repo || !selectedPR) return
    setLoadingComments(true)
    try {
      const response = await fetch(
        `http://localhost:8000/pr-comments?owner=${owner}&repo=${repo}&prNumber=${selectedPR}`
      )
      const data = await response.json()
      setComments(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      setComments([])
    } finally {
      setLoadingComments(false)
    }
  }

  const fetchPendingSuggestions = async () => {
    setLoadingSuggestions(true)
    try {
      const response = await fetch('http://localhost:8000/suggestions?status=pending')
      const data = await response.json()
      setPendingSuggestions(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      setPendingSuggestions([])
    } finally {
      setLoadingSuggestions(false)
    }
  }

  const approveSuggestion = async (id) => {
    try {
      const response = await fetch(`http://localhost:8000/suggestions/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.error) {
        alert(`Error: ${data.error}`)
        return
      }
      alert('Fix applied and commit created successfully!')
      fetchPendingSuggestions()
    } catch (e) {
      console.error(e)
      alert('Failed to approve suggestion')
    }
  }

  const rejectSuggestion = async (id) => {
    try {
      const response = await fetch(`http://localhost:8000/suggestions/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.error) {
        alert(`Error: ${data.error}`)
        return
      }
      fetchPendingSuggestions()
    } catch (e) {
      console.error(e)
      alert('Failed to reject suggestion')
    }
  }

  useEffect(() => {
    fetchPendingSuggestions()
  }, [])

  const resolveComment = async (comment) => {
    const { owner, repo } = selectedRepo
    if (!owner || !repo) {
      alert('Please select a repository first')
      return
    }
    setResolvingId(comment.id)
    try {
      const response = await fetch('http://localhost:8000/debug/process-comment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          commentId: comment.id,
          owner,
          repo
        })
      })

      const data = await response.json()
      if (data.error) {
        alert(`Error: ${data.error}`)
        return
      }
      setSuggestions((prev) => ({
        ...prev,
        [comment.id]: data.suggestion
      }))
      fetchPendingSuggestions()
    } catch (e) {
      console.error(e)
    } finally {
      setResolvingId(null)
    }
  }

  const copyToClipboard = (commentId, text) => {
    navigator.clipboard.writeText(text)
    setCopiedId(commentId)
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  // Parse code diff hunk to render additions/deletions with proper styling
  const renderDiffLines = (diffHunk) => {
    if (!diffHunk) return null
    const lines = diffHunk.split('\n')
    return (
      <div className="diff-container">
        {lines.map((line, idx) => {
          let lineClass = 'diff-line normal'
          if (line.startsWith('+')) {
            lineClass = 'diff-line addition'
          } else if (line.startsWith('-')) {
            lineClass = 'diff-line deletion'
          }
          return (
            <div key={idx} className={lineClass}>
              {line}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-top-bar">
          <div className="app-title-container">
            <div className="app-logo">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
            </div>
            <h1>PR Comment Resolver</h1>
            <span className="badge-ai">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
              AI Powered
            </span>
          </div>

          {/* GitHub Auth Trigger / Status Badge */}
          <div className="auth-container">
            {token ? (
              <div className="auth-status connected glass-panel">
                <span className="pulse-dot"></span>
                <span className="auth-text">GitHub Connected</span>
                <button className="btn-logout" onClick={() => setToken(null)} title="Disconnect GitHub account">
                  Disconnect
                </button>
              </div>
            ) : (
              <a href="http://localhost:8000/auth/github" className="btn-github glass-panel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
                Connect GitHub
              </a>
            )}
          </div>
        </div>
        <p className="app-subtitle">
          Connect your GitHub repository to fetch review comments and resolve them immediately using generative AI.
        </p>
      </header>

      {/* Dashboard Tabs */}
      <div className="dashboard-tabs">
        <button 
          className={`tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => { setActiveTab('pending'); fetchPendingSuggestions(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="9" x2="15" y2="9" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="13" y2="17" />
          </svg>
          Pending Review
          {pendingSuggestions.length > 0 && (
            <span className="count-badge" style={{ marginLeft: '6px', background: 'var(--accent-primary)', color: 'white', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>
              {pendingSuggestions.length}
            </span>
          )}
        </button>
        <button 
          className={`tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
          onClick={() => setActiveTab('manual')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Manual PR Fetch
        </button>
      </div>

      {activeTab === 'pending' ? (
        <main className="comments-section">
          <div className="feed-header">
            <h2 className="feed-title">Pending Code Suggestions</h2>
            <span className="count-badge">{pendingSuggestions.length}</span>
          </div>

          <div className="comments-feed">
            {loadingSuggestions ? (
              <div style={{ textAlign: 'center', padding: '48px' }}>
                <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>Loading suggestions...</p>
              </div>
            ) : pendingSuggestions.length > 0 ? (
              pendingSuggestions.map((sug) => (
                <div key={sug._id} className="comment-card glass-panel">
                  <div className="comment-card-header">
                    <div className="suggestion-meta-row">
                      <span className="repo-badge">{sug.owner}/{sug.repo}</span>
                      <span className="pr-badge">PR #{sug.prNumber}</span>
                      <div className="file-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span>{sug.filePath}</span>
                      </div>
                    </div>
                    <span className={`confidence-badge ${sug.confidence || 'none'}`}>
                      {sug.confidence || 'no'} confidence
                    </span>
                  </div>

                  <div className="comment-card-body">
                    {/* Reviewer Comment */}
                    <div className="comment-bubble-wrapper" style={{ marginBottom: '16px' }}>
                      <div className="reviewer-avatar">RC</div>
                      <div className="comment-bubble">
                        <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                          Reviewer Comment:
                        </div>
                        <p style={{ color: 'var(--text-primary)' }}>{sug.commentBody}</p>
                      </div>
                    </div>

                    {/* Diff content */}
                    {sug.suggestedCode ? (
                      <div className="diff-container" style={{ marginBottom: '16px' }}>
                        {sug.originalCode && sug.originalCode.split('\n').map((line, idx) => (
                          <div key={`orig-${idx}`} className="diff-line deletion">
                            - {line}
                          </div>
                        ))}
                        {sug.suggestedCode.split('\n').map((line, idx) => (
                          <div key={`sugg-${idx}`} className="diff-line addition">
                            + {line}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '16px', background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.1)', borderRadius: '8px', color: 'var(--error)', fontSize: '14px', marginBottom: '16px' }}>
                        No code fix proposed. Gemini suggests manual resolution.
                      </div>
                    )}

                    {/* Explanation */}
                    <div style={{ padding: '14px', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '8px', border: '1px solid var(--card-border)', fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)', marginBottom: '16px' }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>AI Explanation:</strong> {sug.explanation}
                    </div>

                    {/* Actions */}
                    <div className="suggestion-actions">
                      <button 
                        className="btn-approve"
                        onClick={() => approveSuggestion(sug._id)}
                        disabled={sug.confidence === 'none' || !token}
                        title={!token ? 'Connect to GitHub to approve' : ''}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Approve & Apply
                      </button>
                      <button 
                        className="btn-reject"
                        onClick={() => rejectSuggestion(sug._id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state glass-panel">
                <div className="empty-icon-wrapper">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <h3>All Caught Up!</h3>
                <p>There are no suggestions pending review. Leave a comment on a PR to trigger the agent, or fetch comments manually.</p>
              </div>
            )}
          </div>
        </main>
      ) : (
        <>
          {/* Repo Selector Settings */}
          <section className="settings-panel glass-panel">
            {/* Repo Dropdown */}
            <div className="input-group">
              <label className="input-label">Select Repository</label>
              <div style={{ position: 'relative', width: '100%' }}>
                <select 
                  className="input-field"
                  value={selectedRepo.owner ? `${selectedRepo.owner}/${selectedRepo.repo}` : ''}
                  onChange={handleRepoChange}
                  disabled={!token || loadingRepos}
                >
                  <option value="">
                    {loadingRepos ? 'Loading repositories...' : token ? '-- Choose a repository --' : 'Please connect GitHub first'}
                  </option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.full_name}>
                      {r.full_name}
                    </option>
                  ))}
                </select>
                {loadingRepos && (
                  <span className="select-spinner-wrapper">
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                  </span>
                )}
              </div>
            </div>

            {/* PR Dropdown */}
            {selectedRepo.owner && selectedRepo.repo && (
              <div className="input-group">
                <label className="input-label">Select Pull Request</label>
                <div style={{ position: 'relative', width: '100%' }}>
                  <select
                    className="input-field"
                    value={selectedPR}
                    onChange={handlePRChange}
                    disabled={loadingPRs}
                  >
                    <option value="">
                      {loadingPRs ? 'Loading pull requests...' : '-- Choose a PR --'}
                    </option>
                    {pullRequests.map((pr) => (
                      <option key={pr.id} value={pr.number}>
                        #{pr.number} - {pr.title}
                      </option>
                    ))}
                  </select>
                  {loadingPRs && (
                    <span className="select-spinner-wrapper">
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedRepo.owner && selectedRepo.repo && (
              <button 
                className="btn-fetch"
                onClick={handleWatchToggle}
                style={{ 
                  background: watchedRepos.some(
                    (w) => w.owner.toLowerCase() === selectedRepo.owner.toLowerCase() && w.repo.toLowerCase() === selectedRepo.repo.toLowerCase()
                  ) ? 'rgba(220, 38, 38, 0.1)' : 'var(--accent-gradient)',
                  color: watchedRepos.some(
                    (w) => w.owner.toLowerCase() === selectedRepo.owner.toLowerCase() && w.repo.toLowerCase() === selectedRepo.repo.toLowerCase()
                  ) ? 'var(--error)' : 'white',
                  border: watchedRepos.some(
                    (w) => w.owner.toLowerCase() === selectedRepo.owner.toLowerCase() && w.repo.toLowerCase() === selectedRepo.repo.toLowerCase()
                  ) ? '1px solid rgba(220, 38, 38, 0.2)' : 'none'
                }}
              >
                {watchedRepos.some(
                  (w) => w.owner.toLowerCase() === selectedRepo.owner.toLowerCase() && w.repo.toLowerCase() === selectedRepo.repo.toLowerCase()
                ) ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                      <line x1="12" y1="2" x2="12" y2="12"></line>
                    </svg>
                    Unwatch Repo
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    Watch Repo
                  </>
                )}
              </button>
            )}

            <button 
              className="btn-fetch" 
              onClick={fetchComments}
              disabled={loadingComments || !selectedRepo.owner || !selectedRepo.repo || !selectedPR}
            >
              {loadingComments ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  Fetching...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  Fetch Comments
                </>
              )}
            </button>
          </section>

          {/* Comments List Feed */}
          <main className="comments-section">
            {comments.length > 0 && (
              <div className="feed-header">
                <h2 className="feed-title">
                  PR Review Comments
                </h2>
                <span className="count-badge">{comments.length}</span>
              </div>
            )}

            <div className="comments-feed">
              {comments.length > 0 ? (
                comments.map((comment) => (
                  <div key={comment.id} className="comment-card glass-panel">
                    <div className="comment-card-header">
                      <div className="file-info">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span>{comment.path}</span>
                      </div>
                      <span className="line-badge">Line {comment.line || comment.original_line || 'unknown'}</span>
                    </div>

                    <div className="comment-card-body">
                      {renderDiffLines(comment.diff_hunk)}

                      <div className="comment-bubble-wrapper">
                        <div className="reviewer-avatar">
                          {comment.user ? comment.user.login.slice(0, 2).toUpperCase() : 'DF'}
                        </div>
                        <div className="comment-bubble">
                          <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                            @{comment.user ? comment.user.login : 'reviewer'}
                          </div>
                          <p style={{ color: 'var(--text-primary)' }}>{comment.body}</p>
                        </div>
                      </div>

                      <div className="action-row">
                        <button 
                          className={`btn-resolve ${resolvingId === comment.id ? 'glow-pulse' : ''}`}
                          onClick={() => resolveComment(comment)}
                          disabled={resolvingId !== null}
                        >
                          {resolvingId === comment.id ? (
                            <>
                              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                                <path d="M12 2a10 10 0 0 1 10 10" />
                              </svg>
                              Resolving...
                            </>
                          ) : (
                            <>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" style={{ color: 'var(--accent-secondary)' }} />
                              </svg>
                              Resolve with AI
                            </>
                          )}
                        </button>
                      </div>

                      {/* AI Output suggestion bubble */}
                      {suggestions[comment.id] && (
                        <div className="ai-suggestion-box">
                          <div className="suggestion-header">
                            <span className="suggestion-title">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                              </svg>
                              AI Suggestion (Confidence: {suggestions[comment.id].confidence})
                            </span>
                            <button 
                              className={`btn-copy ${copiedId === comment.id ? 'copied' : ''}`}
                              onClick={() => copyToClipboard(comment.id, suggestions[comment.id].suggestedCode)}
                              disabled={!suggestions[comment.id].suggestedCode}
                            >
                              {copiedId === comment.id ? (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                  Copy Suggestion
                                </>
                              )}
                            </button>
                          </div>
                          <div className="suggestion-explanation" style={{ margin: '8px 0', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                            <strong>Explanation:</strong> {suggestions[comment.id].explanation}
                          </div>
                          <div className="suggestion-content">
                            {suggestions[comment.id].suggestedCode || 'No code fix proposed. (confidence: none)'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state glass-panel">
                  <div className="empty-icon-wrapper">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <h3>No PR Comments Loaded</h3>
                  <p>
                    Enter the owner name, repository, and pull request number above to fetch active review comments.
                  </p>
                </div>
              )}
            </div>
          </main>
        </>
      )}
    </div>
  )
}

export default App