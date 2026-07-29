import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AdvancedAssetParser } from '../utils/AdvancedAssetParser';

type Props = {
  text: string;
  category: string;
  initialLimit?: number;
  compact?: boolean;
  className?: string;
};

export default function AssetDetailView({
  text, category, initialLimit = 8, compact = false, className = '',
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => AdvancedAssetParser.parse(text, category), [category, text]);
  if (!text) return null;
  if (items.length <= 1) return <span className={`asset-detail-plain ${className}`}>{text}</span>;

  const visible = expanded ? items : items.slice(0, initialLimit);
  return (
    <div className={`asset-detail-view ${compact ? 'compact' : ''} ${className}`}>
      <div className="asset-detail-items">
        {visible.map((item, index) => (
          <div className="asset-detail-item" key={`${item.originalString}-${index}`}>
            <strong>{item.assetName || item.originalString}</strong>
            {item.tags.length > 0 && (
              <span className="asset-detail-tags">
                {item.tags.map((tag, tagIndex) => (
                  <em key={`${tag.type}-${tagIndex}`} className={`asset-tag asset-tag-${tag.type}`}
                    style={{ '--asset-tag-color': tag.color } as React.CSSProperties}>{tag.text}</em>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
      {items.length > initialLimit && (
        <button type="button" className="asset-detail-toggle"
          onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
          {expanded ? <><ChevronUp size={13} /> 접기</> :
            <><ChevronDown size={13} /> {(items.length - initialLimit).toLocaleString('ko-KR')}개 더 보기 · 총 {items.length.toLocaleString('ko-KR')}개</>}
        </button>
      )}
    </div>
  );
}
