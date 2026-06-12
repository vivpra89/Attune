import { useState, useMemo } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Markdown } from "@/components";
import { cn } from "@/lib/utils";

interface BulletPoint {
  id: string;
  brief: string;
  detail: string;
}

interface ConciseAnswerProps {
  content: string;
}

/**
 * Parse AI response into bullet points with brief and detail sections.
 * Handles multiple common formats:
 * - Bullet lists with colons or dashes separating brief from detail
 * - Numbered lists
 * - Headings followed by content
 */
function parseBulletPoints(content: string): BulletPoint[] {
  const bullets: BulletPoint[] = [];
  
  // Split content into sections
  const lines = content.split('\n');
  
  let currentBullet: { brief: string; detail: string[] } | null = null;
  let bulletId = 0;
  let inCodeBlock = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Track code blocks
    if (trimmedLine.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (currentBullet) {
        currentBullet.detail.push(line);
      }
      continue;
    }
    
    if (inCodeBlock) {
      if (currentBullet) {
        currentBullet.detail.push(line);
      }
      continue;
    }
    
    if (!trimmedLine) {
      // Empty line - might be paragraph break
      if (currentBullet && currentBullet.detail.length > 0) {
        currentBullet.detail.push('');
      }
      continue;
    }
    
    // Check if line is a bullet point or numbered item
    const bulletMatch = trimmedLine.match(/^([-*•]|\d+\.)\s+(.+)$/);
    
    // Check if line is a heading (### or **bold**)
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/) || 
                        trimmedLine.match(/^\*\*(.+)\*\*:?$/);
    
    if (bulletMatch || headingMatch) {
      // Save previous bullet if exists
      if (currentBullet && currentBullet.brief) {
        bullets.push({
          id: `bullet-${bulletId++}`,
          brief: currentBullet.brief,
          detail: currentBullet.detail.join('\n').trim(),
        });
      }
      
      // Start new bullet
      let text = '';
      if (bulletMatch) {
        text = bulletMatch[2];
      } else if (headingMatch) {
        text = headingMatch[2] || headingMatch[1];
      }
      text = text.trim();
      
      // Try to split by common separators (colon, dash, etc.)
      const separatorMatch = text.match(/^([^:—–-]+)(?:[:\-—–]\s*)(.*)$/);
      
      if (separatorMatch && separatorMatch[2].trim()) {
        // Has inline detail after separator
        currentBullet = {
          brief: separatorMatch[1].trim(),
          detail: [separatorMatch[2].trim()],
        };
      } else {
        // Brief only, detail might follow on next lines
        currentBullet = {
          brief: text,
          detail: [],
        };
      }
    } else if (currentBullet) {
      // Add to detail of current bullet (indented or continuation)
      currentBullet.detail.push(line);
    } else {
      // Standalone line before any bullets - create a bullet for it
      const separatorMatch = trimmedLine.match(/^([^:—–-]+)(?:[:\-—–]\s*)(.*)$/);
      if (separatorMatch && separatorMatch[1].length < 100) {
        currentBullet = {
          brief: separatorMatch[1].trim(),
          detail: separatorMatch[2].trim() ? [separatorMatch[2].trim()] : [],
        };
      } else {
        // Just add as a standalone brief
        currentBullet = {
          brief: trimmedLine,
          detail: [],
        };
      }
    }
  }
  
  // Save last bullet
  if (currentBullet && currentBullet.brief) {
    bullets.push({
      id: `bullet-${bulletId++}`,
      brief: currentBullet.brief,
      detail: currentBullet.detail.join('\n').trim(),
    });
  }
  
  return bullets.filter(b => b.brief.length > 0);
}

export const ConciseAnswer = ({ content }: ConciseAnswerProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  
  const bulletPoints = useMemo(() => parseBulletPoints(content), [content]);
  
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  
  // If no bullets parsed or only one bullet, fall back to regular markdown
  if (bulletPoints.length === 0 || bulletPoints.length === 1) {
    return (
      <div className="prose prose-base max-w-none dark:prose-invert text-base leading-relaxed">
        <Markdown>{content}</Markdown>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {bulletPoints.map((bullet) => {
        const isExpanded = expandedIds.has(bullet.id);
        const hasDetail = bullet.detail.trim().length > 0;
        
        return (
          <div
            key={bullet.id}
            className={cn(
              "rounded-md border border-border/40 bg-muted/10 overflow-hidden transition-colors",
              hasDetail && "hover:bg-muted/20"
            )}
          >
            <button
              onClick={() => hasDetail && toggleExpand(bullet.id)}
              disabled={!hasDetail}
              className={cn(
                "w-full flex items-start gap-2 p-2.5 text-left transition-colors",
                hasDetail && "cursor-pointer",
                !hasDetail && "cursor-default"
              )}
            >
              {hasDetail && (
                <ChevronRightIcon
                  className={cn(
                    "w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
              )}
              {!hasDetail && (
                <span className="w-4 h-4 shrink-0 mt-0.5 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                </span>
              )}
              <span className="flex-1 text-sm font-medium text-foreground">
                {bullet.brief}
              </span>
            </button>
            
            {isExpanded && hasDetail && (
              <div className="px-2.5 pb-2.5 pl-8 border-t border-border/20 pt-2">
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed text-muted-foreground">
                  <Markdown>{bullet.detail}</Markdown>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
