import type { Course } from '../types';

export function SectionToggle({
  course,
  currentSectionId,
  onToggle,
  hidden,
  tier,
  overlapIds,
}: {
  course: Course;
  currentSectionId: string | null;
  onToggle: () => void;
  hidden: boolean;
  tier: 'need' | 'nice' | 'optional';
  overlapIds: Set<string>;
}) {
  const isConflicting = overlapIds.has(course.id);
  const assigned = course.sections.find((s) => s.id === currentSectionId) ?? course.sections[0];

  return (
    <div className={`bid-row bid-row-${tier} ${isConflicting ? 'bid-row-conflict' : ''} ${hidden ? 'bid-row-hidden' : ''}`}>
      {course.isObligatory ? (
        <span className="auto-status" title="Obligatory — cannot be removed">✓</span>
      ) : (
        <input
          type="checkbox"
          className="course-checkbox"
          checked={!hidden}
          onChange={onToggle}
          title={hidden ? 'Show on schedule' : 'Hide from schedule'}
        />
      )}
      <div className="bid-row-info">
        {course.isObligatory && <span className="obligatory-badge-sm">SFMBA Obligatory</span>}
        <span className="bid-row-number">{course.number}</span>
        <span className="bid-row-title">{course.title}</span>
        <span className={`term-badge term-badge-sm term-${course.term.toLowerCase()}`}>{course.term}</span>
      </div>
      <div className="section-toggle-group">
        <span className="section-single">{assigned?.days} {assigned?.time}</span>
      </div>
    </div>
  );
}
