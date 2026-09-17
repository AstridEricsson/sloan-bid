import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import type { Course, Term } from '../types';
import { STUDENT } from '../data/courses';
import { computeSchedule } from '../utils/scheduleEngine';

const TOTAL_CREDITS = 1000;

type Slot = { day: string; start: number; end: number; term: string | null };

function slotsConflict(a: Slot, b: Slot) {
  if (a.day !== b.day) return false;
  if (a.start >= b.end || a.end <= b.start) return false;
  if ((a.term === 'H3' && b.term === 'H4') || (a.term === 'H4' && b.term === 'H3')) return false;
  return true;
}

export function BiddingScreen() {
  const {
    needToHave,
    niceToHave,
    optional,
    sectionOverrides,
    setScreen,
    deselectedIds,
  } = useApp();

  // Replicate blockedNiceIds logic (same as BrowseScreen/ScheduleScreen)
  const obligatorySlots: Slot[] = STUDENT.obligatoryBlocks.map((ob) => ({
    day: ob.day, start: ob.startHour, end: ob.endHour, term: null,
  }));

  // Deselected courses stay in the tier but are excluded from the schedule.
  const visibleNeed = needToHave.filter((c) => !deselectedIds.has(c.id));

  const needOnlyBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: [], optional: [], sectionOverrides }),
    [visibleNeed, sectionOverrides]
  );

  const needBaseSlots = useMemo(() => {
    const slots: Slot[] = [...obligatorySlots];
    for (const b of needOnlyBlocks) {
      if (b.tier === 'need' && !b.conflict) {
        slots.push({ day: b.day, start: b.section.startHour, end: b.section.endHour, term: b.course.term });
      }
    }
    return slots;
  }, [needOnlyBlocks]);

  const blockedNiceIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const c of niceToHave) {
      const canFit = c.sections.some((sec) => {
        const slots: Slot[] = sec.dayKeys.map((d) => ({ day: d, start: sec.startHour, end: sec.endHour, term: c.term as Term }));
        return !slots.some((s) => needBaseSlots.some((o) => slotsConflict(s, o)));
      });
      if (!canFit) blocked.add(c.id);
    }
    return blocked;
  }, [niceToHave, needBaseSlots]);

  const visibleNice = niceToHave.filter((c) => !deselectedIds.has(c.id) && !blockedNiceIds.has(c.id));
  const visibleOptional = optional.filter((c) => !deselectedIds.has(c.id));

  const placedBlocks = useMemo(
    () => computeSchedule({ needToHave: visibleNeed, niceToHave: visibleNice, optional: visibleOptional, sectionOverrides }),
    [visibleNeed, visibleNice, visibleOptional, sectionOverrides]
  );

  // Get unique placed (non-conflicting) courses in tier order
  const scheduledCourses = useMemo(() => {
    const seen = new Set<string>();
    const courses: { course: Course; tier: 'need' | 'nice' | 'optional' }[] = [];
    for (const b of placedBlocks) {
      if (!b.couldntFit && !b.conflict && !seen.has(b.course.id)) {
        seen.add(b.course.id);
        courses.push({ course: b.course, tier: b.tier });
      }
    }
    return courses;
  }, [placedBlocks]);

  // Bid state: courseId → bid amount
  const [bids, setBids] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const totalBid = useMemo(
    () => Object.values(bids).reduce((sum, v) => sum + (v || 0), 0),
    [bids]
  );

  const remaining = TOTAL_CREDITS - totalBid;

  const handleBidChange = (courseId: string, value: string) => {
    const num = value === '' ? 0 : Math.max(0, parseInt(value, 10) || 0);
    setBids((prev) => ({ ...prev, [courseId]: num }));
  };

  const totalUnits = useMemo(
    () => scheduledCourses.reduce((sum, { course }) => sum + course.units, 0),
    [scheduledCourses]
  );

  const tierLabel = (tier: 'need' | 'nice' | 'optional') => {
    if (tier === 'need') return 'Need-to-Have';
    if (tier === 'nice') return 'Nice-to-Have';
    return 'Optional';
  };

  const handleAddToCalendar = () => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SloanBid//EN',
      'BEGIN:VEVENT',
      'DTSTART:20260110T090000',
      'DTEND:20260115T170000',
      'SUMMARY:SloanBid — Next Bidding Window',
      'DESCRIPTION:The next bidding window for MIT Sloan course registration opens January 10 and closes January 15\\, 2026.',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sloan-bid-next-window.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Confirmation view ──
  if (submitted) {
    return (
      <div className="screen bidding-screen">
        <div className="confirmation-card">
          <div className="confirmation-icon">&#x2714;</div>
          <h1 className="confirmation-title">You've completed the bidding!</h1>
          <p className="confirmation-text">
            Your bids have been submitted for {scheduledCourses.length} courses totaling {totalBid} credits.
          </p>
          <div className="confirmation-window">
            <h3>Next Bidding Window</h3>
            <p className="confirmation-dates">
              Opens <strong>January 10, 2026</strong> · Closes <strong>January 15, 2026</strong>
            </p>
          </div>
          <button className="save-schedule-btn" onClick={handleAddToCalendar}>
            Add to Calendar
          </button>
          <button className="browse-back-link confirmation-back" onClick={() => setSubmitted(false)}>
            ← Back to edit bids
          </button>
        </div>
      </div>
    );
  }

  // ── Bidding form ──
  return (
    <div className="screen bidding-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Place Your Bids</h1>
          <p className="screen-subtitle">
            Allocate your {TOTAL_CREDITS} bidding credits across your scheduled courses.
          </p>
        </div>
        <div className="bidding-budget">
          <div className={`budget-remaining ${remaining < 0 ? 'over-budget' : ''}`}>
            <span className="budget-number">{remaining}</span>
            <span className="budget-label">credits remaining</span>
          </div>
          <div className="budget-bar">
            <div
              className="budget-bar-fill"
              style={{ width: `${Math.min(100, (totalBid / TOTAL_CREDITS) * 100)}%` }}
            />
          </div>
          <div className="budget-total">
            {totalBid} / {TOTAL_CREDITS} used
          </div>
        </div>
      </div>

      <button className="browse-back-link bidding-back" onClick={() => setScreen('browse')}>
        ← Back to Browse Compatible
      </button>

      <div className="bidding-summary-row">
        <span>{scheduledCourses.length} courses · {totalUnits} units</span>
      </div>

      <div className="bidding-list">
        {scheduledCourses.map(({ course, tier }) => (
          <div key={course.id} className={`bidding-row tier-${tier}`}>
            <div className="bidding-course-info">
              <div className="bidding-course-header">
                <span className="bidding-course-number">{course.number}</span>
                <span className={`term-badge term-${course.term.toLowerCase()}`}>{course.term} · {course.units}u</span>
                <span className={`bidding-tier-badge tier-badge-${tier}`}>
                  {course.isObligatory ? 'Obligatory' : tierLabel(tier)}
                </span>
              </div>
              <h3 className="bidding-course-title">{course.title}</h3>
              <p className="bidding-course-professor">{course.professor}</p>
            </div>
            {course.isObligatory ? (
              <div className="bidding-guaranteed">
                You are guaranteed this course
              </div>
            ) : (
              <div className="bidding-input-wrap">
                <input
                  type="number"
                  className="bidding-input"
                  min={0}
                  max={TOTAL_CREDITS}
                  placeholder="0"
                  value={bids[course.id] || ''}
                  onChange={(e) => handleBidChange(course.id, e.target.value)}
                />
                <span className="bidding-input-label">credits</span>
              </div>
            )}
          </div>
        ))}

        {scheduledCourses.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <p>No courses in your schedule yet.</p>
            <button onClick={() => setScreen('schedule')}>
              Go to Schedule
            </button>
          </div>
        )}
      </div>

      {remaining < 0 && (
        <div className="bidding-warning">
          You are {Math.abs(remaining)} credits over budget. Reduce your bids to stay within {TOTAL_CREDITS} credits.
        </div>
      )}

      {remaining > 0 && (
        <div className="bidding-warning bidding-warning-under">
          You have {remaining} credits left to allocate. Use all {TOTAL_CREDITS} credits to submit.
        </div>
      )}

      {scheduledCourses.length > 0 && (
        <button
          className="save-schedule-btn bidding-submit"
          disabled={remaining !== 0}
          onClick={() => setSubmitted(true)}
        >
          Submit Bids
        </button>
      )}
    </div>
  );
}
