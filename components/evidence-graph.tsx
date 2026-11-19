'use client'

import { useState } from 'react'

type EvidenceRelationship = {
  source: string
  target: string
  relationship: string
  explanation?: string
}

function shorten(value: string, maxLength = 22) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export default function EvidenceGraph({ relationships }: { relationships: EvidenceRelationship[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const visibleRelationships = relationships.slice(0, 24)
  const sources = [...new Set(visibleRelationships.map((item) => item.source))]
  const targets = [...new Set(visibleRelationships.map((item) => item.target))]
  const height = Math.max(240, Math.max(sources.length, targets.length) * 72 + 48)
  const selectedRelationship = relationships[selectedIndex]

  return <div className="evidence-graph">
    <div className="evidence-graph-canvas" role="img" aria-label={`Evidence relationship graph. ${visibleRelationships.length} relationships visualised from backend results.`}>
      <svg viewBox={`0 0 900 ${height}`} preserveAspectRatio="xMidYMin meet" aria-hidden="true">
        {visibleRelationships.map((item, index) => {
          const sourceY = 36 + sources.indexOf(item.source) * 72
          const targetY = 36 + targets.indexOf(item.target) * 72
          const relationshipY = (sourceY + targetY) / 2
          return <g key={`edge-${index}`}>
            <path d={`M 214 ${sourceY} C 365 ${sourceY}, 535 ${targetY}, 686 ${targetY}`} fill="none" stroke="#bdbdbd" strokeWidth="1.5" />
            <path d={`M 676 ${targetY - 4} L 686 ${targetY} L 676 ${targetY + 4}`} fill="none" stroke="#777" strokeWidth="1.5" />
            <rect x="368" y={relationshipY - 11} width="164" height="22" rx="11" fill="#fff" stroke="#dedede" />
            <text x="450" y={relationshipY + 4} textAnchor="middle" fill="#444" fontSize="10">{shorten(item.relationship, 24)}</text>
          </g>
        })}
        {sources.map((label, index) => {
          const y = 36 + index * 72
          return <g key={`source-${label}`}>
            <rect x="24" y={y - 20} width="190" height="40" rx="10" fill="#fff" stroke="#d9d9d9" />
            <text x="119" y={y + 4} textAnchor="middle" fill="#222" fontSize="11">{shorten(label)}</text>
          </g>
        })}
        {targets.map((label, index) => {
          const y = 36 + index * 72
          return <g key={`target-${label}`}>
            <rect x="686" y={y - 20} width="190" height="40" rx="10" fill="#fff" stroke="#d9d9d9" />
            <text x="781" y={y + 4} textAnchor="middle" fill="#222" fontSize="11">{shorten(label)}</text>
          </g>
        })}
      </svg>
    </div>
    {relationships.length > 24 && <p className="graph-count-note">Showing 24 of {relationships.length} returned relationships in the graph.</p>}
    <div className="evidence-relationship-list" role="list" aria-label="Returned evidence relationships">{relationships.map((item, index) => <div role="listitem" key={`${item.source}-${item.target}-${index}`}><button type="button" aria-pressed={selectedIndex === index} onClick={() => setSelectedIndex(index)}><span>{item.source}</span><strong>{item.relationship}</strong><span>{item.target}</span></button></div>)}</div>
    {selectedRelationship?.explanation && <p className="selected-relationship-explanation"><strong>Returned explanation:</strong> {selectedRelationship.explanation}</p>}
  </div>
}
