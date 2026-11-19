'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  AudioLines,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileSearch,
  FileText,
  Filter,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Video,
  X,
} from 'lucide-react'
import type { InvestigationRecord } from '@/lib/truthlens-api'

interface AnalysisHistoryProps {
  records: InvestigationRecord[]
  isLoading: boolean
  error: Error | null
  onRefresh?: () => void
}

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AnalysisHistory({
  records,
  isLoading,
  error,
  onRefresh,
}: AnalysisHistoryProps) {
  // Filter & Search State
  const [query, setQuery] = useState('')
  const [mediaFilter, setMediaFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'text'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'review' | 'clean' | 'completed' | 'failed'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'name-asc' | 'name-desc'>('newest')

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Filtered and sorted records
  const filteredRecords = useMemo(() => {
    return records
      .filter((rec) => {
        // Query search
        if (query.trim()) {
          const q = query.trim().toLowerCase()
          const matchFilename = rec.filename.toLowerCase().includes(q)
          const matchId = rec.id.toLowerCase().includes(q)
          const matchAssessment = rec.assessment?.toLowerCase().includes(q) ?? false
          const matchReport = rec.reportId?.toLowerCase().includes(q) ?? false
          if (!matchFilename && !matchId && !matchAssessment && !matchReport) {
            return false
          }
        }

        // Media type filter
        if (mediaFilter !== 'all' && rec.mediaType !== mediaFilter) {
          return false
        }

        // Status filter
        if (statusFilter === 'review' && rec.requiresReview !== true) {
          return false
        }
        if (statusFilter === 'clean' && rec.requiresReview !== false) {
          return false
        }
        if (statusFilter === 'completed' && rec.status.toLowerCase() !== 'completed') {
          return false
        }
        if (statusFilter === 'failed' && rec.status.toLowerCase() !== 'failed') {
          return false
        }

        return true
      })
      .sort((a, b) => {
        if (sortOrder === 'oldest') {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        }
        if (sortOrder === 'name-asc') {
          return a.filename.localeCompare(b.filename)
        }
        if (sortOrder === 'name-desc') {
          return b.filename.localeCompare(a.filename)
        }
        // default: newest
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [records, query, mediaFilter, statusFilter, sortOrder])

  // Pagination calculations
  const totalItems = filteredRecords.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * pageSize
  const paginatedRecords = filteredRecords.slice(startIndex, startIndex + pageSize)

  const handleResetFilters = () => {
    setQuery('')
    setMediaFilter('all')
    setStatusFilter('all')
    setSortOrder('newest')
    setCurrentPage(1)
  }

  return (
    <section className="analysis-history-root">
      {/* 1. Header Toolbar with Search & Controls */}
      <div className="history-control-bar">
        <div className="history-search-group">
          <div className="history-search-box">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search by file name, investigation ID, or assessment notes..."
              aria-label="Search investigations"
            />
            {query && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => {
                  setQuery('')
                  setCurrentPage(1)
                }}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="history-filter-controls">
          {/* Media type filter */}
          <div className="filter-select-wrap">
            <label htmlFor="media-filter-select" className="sr-only">Filter by media type</label>
            <select
              id="media-filter-select"
              value={mediaFilter}
              onChange={(e) => {
                setMediaFilter(e.target.value as typeof mediaFilter)
                setCurrentPage(1)
              }}
              className="history-select"
            >
              <option value="all">All Modalities</option>
              <option value="image">Images (PNG, JPG, WebP)</option>
              <option value="video">Videos (MP4, WebM, MOV)</option>
              <option value="audio">Audio (MP3, WAV, M4A)</option>
              <option value="text">Cross-Modal Bundles</option>
            </select>
          </div>

          {/* Status filter */}
          <div className="filter-select-wrap">
            <label htmlFor="status-filter-select" className="sr-only">Filter by status</label>
            <select
              id="status-filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as typeof statusFilter)
                setCurrentPage(1)
              }}
              className="history-select"
            >
              <option value="all">All Statuses</option>
              <option value="review">Review Requested</option>
              <option value="clean">Clean / No Anomalies</option>
              <option value="completed">Completed Status</option>
              <option value="failed">Failed / Corrupted</option>
            </select>
          </div>

          {/* Sort selector */}
          <div className="filter-select-wrap">
            <label htmlFor="sort-order-select" className="sr-only">Sort records</label>
            <select
              id="sort-order-select"
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value as typeof sortOrder)
                setCurrentPage(1)
              }}
              className="history-select"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="name-asc">Filename (A → Z)</option>
              <option value="name-desc">Filename (Z → A)</option>
            </select>
          </div>

          {/* Page size selector */}
          <div className="filter-select-wrap">
            <label htmlFor="page-size-select" className="sr-only">Page size</label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="history-select size-select"
            >
              <option value={5}>5 / page</option>
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
            </select>
          </div>

          {onRefresh && (
            <button
              type="button"
              className="btn-refresh-history"
              onClick={onRefresh}
              title="Refresh analysis history"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="history-error-banner" role="alert">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span>Investigation history could not be synced from the service. Showing local cache.</span>
        </div>
      )}

      {/* 2. Main History Table */}
      <div className="history-table-container">
        <table className="analysis-records-table">
          <thead>
            <tr>
              <th className="th-media">Evidence / File</th>
              <th className="th-type">Modality</th>
              <th className="th-date">Analysis Date</th>
              <th className="th-status">Processing Status</th>
              <th className="th-assessment">Forensic Assessment</th>
              <th className="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="table-loading-cell">
                  <div className="loading-state-box">
                    <RefreshCw className="h-5 w-5 spinning text-cyan-400" />
                    <span>Loading analysis history...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedRecords.length > 0 ? (
              paginatedRecords.map((rec) => {
                const Icon = rec.mediaType === 'video'
                  ? Video
                  : rec.mediaType === 'audio'
                    ? AudioLines
                    : ImageIcon

                const isReview = rec.requiresReview === true
                const isFailed = rec.status.toLowerCase() === 'failed'

                return (
                  <tr key={rec.id} className="history-table-row">
                    {/* Column 1: Evidence / File */}
                    <td className="td-file-info">
                      <div className="file-info-cluster">
                        <span className={`file-type-avatar ${rec.mediaType}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="file-text-col">
                          <strong className="table-filename" title={rec.filename}>
                            {rec.filename}
                          </strong>
                          <span className="table-rec-id">{rec.id}</span>
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Modality */}
                    <td className="td-modality">
                      <span className={`modality-badge ${rec.mediaType}`}>
                        {rec.mediaType.toUpperCase()}
                      </span>
                    </td>

                    {/* Column 3: Analysis Date */}
                    <td className="td-date">
                      <div className="date-time-cluster">
                        <span className="date-text">{formatDate(rec.createdAt)}</span>
                        <small className="time-text">{formatTime(rec.createdAt)}</small>
                      </div>
                    </td>

                    {/* Column 4: Processing Status */}
                    <td className="td-status">
                      <span
                        className={`status-indicator-badge ${
                          isFailed ? 'failed' : isReview ? 'review' : 'clean'
                        }`}
                      >
                        {isFailed ? (
                          <>
                            <X className="h-3 w-3 mr-1" />
                            Failed
                          </>
                        ) : isReview ? (
                          <>
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Review Required
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Completed
                          </>
                        )}
                      </span>
                    </td>

                    {/* Column 5: Assessment */}
                    <td className="td-assessment">
                      <p className="table-assessment-text" title={rec.assessment}>
                        {rec.assessment || 'Analysis completed with model telemetry.'}
                      </p>
                    </td>

                    {/* Column 6: Actions */}
                    <td className="td-actions">
                      <div className="actions-btn-group">
                        <Link
                          href={`/workspace?investigation=${encodeURIComponent(rec.id)}`}
                          className="btn-table-view"
                        >
                          View Results
                        </Link>
                        {rec.reportId && (
                          <Link
                            href={`/workspace?section=reports&report=${encodeURIComponent(rec.reportId)}`}
                            className="btn-table-report"
                            title="Open certified PDF report"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>PDF</span>
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={6} className="table-empty-cell">
                  <div className="table-empty-state">
                    <span className="empty-icon-wrap">
                      <FileSearch className="h-5 w-5 text-slate-400" />
                    </span>
                    <h4>
                      {query || mediaFilter !== 'all' || statusFilter !== 'all'
                        ? 'No matching investigations'
                        : 'No analysis history found'}
                    </h4>
                    <p>
                      {query || mediaFilter !== 'all' || statusFilter !== 'all'
                        ? 'No records match your active search filters. Try clearing or expanding your query.'
                        : 'Your submitted digital forensics investigations will be recorded and displayed here.'}
                    </p>
                    {query || mediaFilter !== 'all' || statusFilter !== 'all' ? (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="btn-reset-filters"
                      >
                        Reset All Filters
                      </button>
                    ) : (
                      <Link
                        href="/workspace?section=image-analysis"
                        className="btn-start-first"
                      >
                        <Plus className="h-3.5 w-3.5" /> Start First Analysis
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Pagination Footer */}
      {totalItems > 0 && (
        <div className="history-pagination-footer">
          <div className="pagination-range-text">
            Showing <strong>{startIndex + 1}</strong> to{' '}
            <strong>{Math.min(startIndex + pageSize, totalItems)}</strong> of{' '}
            <strong>{totalItems}</strong> analysis records
          </div>

          <div className="pagination-controls-group">
            <button
              type="button"
              className="page-nav-btn"
              disabled={safeCurrentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Previous</span>
            </button>

            <div className="page-numbers-list">
              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1
                // Show pages close to current
                if (
                  totalPages > 7 &&
                  Math.abs(pageNum - safeCurrentPage) > 2 &&
                  pageNum !== 1 &&
                  pageNum !== totalPages
                ) {
                  if (pageNum === 2 || pageNum === totalPages - 1) {
                    return <span key={`ellipsis-${pageNum}`} className="page-ellipsis">…</span>
                  }
                  return null
                }

                return (
                  <button
                    key={pageNum}
                    type="button"
                    className={`page-num-btn ${pageNum === safeCurrentPage ? 'active' : ''}`}
                    onClick={() => setCurrentPage(pageNum)}
                    aria-label={`Go to page ${pageNum}`}
                    aria-current={pageNum === safeCurrentPage ? 'page' : undefined}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              className="page-nav-btn"
              disabled={safeCurrentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <span>Next</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
