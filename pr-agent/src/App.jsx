import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [comments, setComments] = useState([])
  const [suggestions, setSuggestions] = useState({})
  
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

  const resolveComment = async (comment) => {
    setResolvingId(comment.id)
    try {
      const response = await fetch('http://localhost:8000/resolve-comment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: comment.body,
          path: comment.path,
          line: comment.line,
          diff_hunk: comment.diff_hunk
        })
      })

      const data = await response.json()
      setSuggestions((prev) => ({
        ...prev,
        [comment.id]: data.suggestion
      }))
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

        {/* PR Dropdown (disabled/hidden until repo selected) */}
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
                {/* Card Header: File info & line */}
                <div className="comment-card-header">
                  <div className="file-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)' }}>
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{comment.path}</span>
                  </div>
                  <span className="line-badge">Line {comment.line}</span>
                </div>

                <div className="comment-card-body">
                  {/* Diff Hunk snippet */}
                  {renderDiffLines(comment.diff_hunk)}

                  {/* Reviewer Comment Bubble */}
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

                  {/* Suggestion AI Actions */}
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
                          AI Suggestion
                        </span>
                        <button 
                          className={`btn-copy ${copiedId === comment.id ? 'copied' : ''}`}
                          onClick={() => copyToClipboard(comment.id, suggestions[comment.id])}
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
                      <div className="suggestion-content">
                        {suggestions[comment.id]}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            /* Empty State */
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
    </div>
  )
}

export default App