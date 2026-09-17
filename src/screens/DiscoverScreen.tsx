import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ALL_COURSES } from '../data/courses';
import type { Course } from '../types';
import { StarRating } from '../components/StarRating';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function DiscoverScreen() {
  const { addedCourses, addCourse, removeCourse, setScreen } = useApp();
  const [search, setSearch] = useState('');
  const [filterDay, setFilterDay] = useState<string>('');
  const [filterMinRating, setFilterMinRating] = useState<number>(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return ALL_COURSES.filter((c) => {
      if (search && !c.title.toLowerCase().includes(search.toLowerCase()) &&
          !c.number.toLowerCase().includes(search.toLowerCase()) &&
          !c.professor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterDay && !c.sections.some((s) => s.dayKeys.includes(filterDay))) return false;
      if (filterMinRating && c.rating < filterMinRating) return false;
      return true;
    });
  }, [search, filterDay, filterMinRating]);

  const isAdded = (c: Course) => addedCourses.some((x) => x.id === c.id);

  const totalUnits = addedCourses.reduce((sum, c) => sum + c.units, 0);

  const handleCardClick = (id: string) => {
    setExpanded(expanded === id ? null : id);
  };

  const handleAdd = (e: React.MouseEvent, c: Course) => {
    e.stopPropagation();
    if (isAdded(c)) {
      removeCourse(c.id);
    } else {
      addCourse(c);
    }
  };

  return (
    <div className="screen discover-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Course Catalog</h1>
          <p className="screen-subtitle">Browse and add courses to your consideration list.</p>
        </div>
        {addedCourses.length > 0 && (
          <div className="header-actions">
            <div className="added-pill">
              <span>{totalUnits} unit{totalUnits !== 1 ? 's' : ''} added</span>
            </div>
            <p className="added-pill-note">including your program's obligatory course</p>
            <button className="cta-btn" onClick={() => setScreen('prioritize')}>
              Prioritize courses →
            </button>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="search-input-wrap">
          <span className="search-icon">⌕</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search courses, professors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        <div className="filter-group">
          <label className="filter-label">Day</label>
          <div className="filter-chips">
            {DAYS.map((d) => (
              <button
                key={d}
                className={`chip ${filterDay === d ? 'active' : ''}`}
                onClick={() => setFilterDay(filterDay === d ? '' : d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <label className="filter-label">Min Rating</label>
          <div className="filter-chips">
            {[4.0, 4.5].map((r) => (
              <button
                key={r}
                className={`chip ${filterMinRating === r ? 'active' : ''}`}
                onClick={() => setFilterMinRating(filterMinRating === r ? 0 : r)}
              >
                ★ {r}+
              </button>
            ))}
          </div>
        </div>

        {(filterDay || filterMinRating > 0) && (
          <button className="filter-clear-all" onClick={() => { setFilterDay(''); setFilterMinRating(0); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Course Grid */}
      <div className="course-grid">
        {filtered.map((course) => (
          <div
            key={course.id}
            className={`course-card ${course.isCompleted ? 'completed' : ''} ${expanded === course.id ? 'expanded' : ''} ${isAdded(course) && !course.isCompleted ? 'added' : ''}`}
            onClick={() => !course.isCompleted && handleCardClick(course.id)}
          >
            {course.isCompleted && (
              <div className="completed-badge">Completed</div>
            )}

            <div className="course-card-header">
              <div className="course-number">
                {course.number}
                <span className={`term-badge term-${course.term.toLowerCase()}`}>{course.term} · {course.units}u</span>
              </div>
              {!course.isCompleted && (
                <button
                  className={`add-btn ${isAdded(course) ? 'added' : ''}`}
                  onClick={(e) => handleAdd(e, course)}
                  title={isAdded(course) ? 'Remove from list' : 'Add to my list'}
                >
                  {isAdded(course) ? '✓' : '+'}
                </button>
              )}
            </div>

            <h3 className="course-title">{course.title}</h3>
            <p className="course-professor">{course.professor}</p>

            <StarRating rating={course.rating} size="sm" />

            <p className="course-quote">"{course.reviewQuote}"</p>

            {!course.isCompleted && (
              <span className="course-expand-hint">
                {expanded === course.id ? 'Show less ▲' : 'Read more ▼'}
              </span>
            )}

            <div className="course-sections-preview">
              {course.sections.map((s) => (
                <span key={s.id} className="section-tag">
                  {s.days} · {s.time}
                </span>
              ))}
            </div>

            {/* Expanded Detail */}
            {expanded === course.id && (
              <div className="course-expanded" onClick={(e) => e.stopPropagation()}>
                <div className="expanded-divider" />
                <div className="expanded-syllabus">
                  <div className="syllabus-icon">&#x1F4D8;</div>
                  <h4 className="expanded-label">Course Overview</h4>
                  <p className="course-description">{course.description}</p>
                </div>
                {!isAdded(course) && (
                  <button
                    className="add-btn-expanded"
                    onClick={(e) => handleAdd(e, course)}
                  >
                    + Add to My List
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <p>No courses match your filters.</p>
            <button onClick={() => { setSearch(''); setFilterDay(''); setFilterMinRating(0); }}>
              Clear all filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
