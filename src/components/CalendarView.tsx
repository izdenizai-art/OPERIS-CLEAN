import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Info, LayoutGrid } from 'lucide-react';
import type { Priority, Task } from '@/lib/types';
import { PRIORITY_COLORS } from '@/lib/types';
import { dateStr, TURKISH_DAYS, TURKISH_MONTHS, formatTurkishDay } from '@/lib/date';
import { importantDateMap } from '@/lib/importantDates';

interface Props {
  tasks: Task[];
  compact?: boolean;
}

type ViewMode = 'month' | 'year';

function getTopPriority(dayTasks: Task[]): Priority {
  return dayTasks.reduce<Priority>(
    (current, task) =>
      task.priority === 'yuksek'
        ? 'yuksek'
        : task.priority === 'orta' && current !== 'yuksek'
          ? 'orta'
          : current,
    'dusuk',
  );
}

function getTaskTitle(dayTasks: Task[]) {
  return dayTasks.map((task) => `${task.time} — ${task.title}`).join('\n');
}

export default function CalendarView({ tasks, compact = false }: Props) {
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!map.has(task.date)) map.set(task.date, []);
      map.get(task.date)!.push(task);
    }
    for (const dayTasks of map.values()) {
      dayTasks.sort((a, b) => a.time.localeCompare(b.time));
    }
    return map;
  }, [tasks]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = dateStr(new Date());
  const importantByDate = useMemo(() => importantDateMap(year), [year]);

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthTasks = useMemo(
    () => tasks
      .filter(task => !task.deletedAt && task.date.startsWith(monthPrefix))
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)),
    [tasks, monthPrefix],
  );
  const monthImportantDates = useMemo(
    () => Array.from(importantByDate.entries())
      .filter(([date]) => date.startsWith(monthPrefix))
      .flatMap(([date, items]) => items.map(item => ({ date, item })))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [importantByDate, monthPrefix],
  );

  const changePeriod = (direction: -1 | 1) => {
    setSelected(null);
    if (viewMode === 'year') {
      setCursor(new Date(year + direction, month, 1));
    } else {
      setCursor(new Date(year, month + direction, 1));
    }
  };

  const openMonth = (monthIndex: number) => {
    setCursor(new Date(year, monthIndex, 1));
    setSelected(null);
    setViewMode('month');
  };

  return (
    <div className={`rounded-2xl bg-slate-800/50 ring-1 ring-slate-700/50 ${compact ? 'p-3 dashboard-calendar' : 'p-4'}`}>
      <div className={`${compact ? 'mb-2' : 'mb-4'} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center justify-between gap-2 sm:justify-start">
          <button
            onClick={(event) => { event.stopPropagation(); changePeriod(-1); }}
            className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-700"
            aria-label={viewMode === 'year' ? 'Önceki yıl' : 'Önceki ay'}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h3 className={`${compact ? 'min-w-[130px] text-sm' : 'min-w-[180px] text-lg'} text-center font-semibold text-white`}>
            {viewMode === 'year' ? year : `${TURKISH_MONTHS[month]} ${year}`}
          </h3>
          <button
            onClick={(event) => { event.stopPropagation(); changePeriod(1); }}
            className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-700"
            aria-label={viewMode === 'year' ? 'Sonraki yıl' : 'Sonraki ay'}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className={`grid grid-cols-2 rounded-xl bg-slate-900/60 p-1 ring-1 ring-slate-700 ${compact ? 'text-xs' : ''}`}>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setSelected(null); setViewMode('month'); }}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              viewMode === 'month' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <CalendarDays className="h-4 w-4" /> Aylık
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setSelected(null);
              setViewMode('year');
            }}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              viewMode === 'year' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="h-4 w-4" /> Yıllık
          </button>
        </div>
      </div>

      {viewMode === 'month' ? (
        <MonthCalendar
          year={year}
          month={month}
          today={today}
          selected={selected}
          tasksByDate={tasksByDate}
          importantByDate={importantByDate}
          onSelect={setSelected}
        />
      ) : (
        <YearCalendar
          year={year}
          today={today}
          tasksByDate={tasksByDate}
          importantByDate={importantByDate}
          onOpenMonth={openMonth}
          compact={compact}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-700/50 pt-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ backgroundColor: `${PRIORITY_COLORS.yuksek}55` }} /> Yüksek</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ backgroundColor: `${PRIORITY_COLORS.orta}55` }} /> Orta</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ backgroundColor: `${PRIORITY_COLORS.dusuk}55` }} /> Düşük</span>
        <span className="ml-auto hidden text-slate-500 sm:inline">Başlıkları görmek için kayıtlı günün üzerinde bekleyin.</span>
      </div>
      <div className="calendar-month-summary mt-3 grid gap-3 md:grid-cols-2">
        <section className="calendar-summary-panel rounded-xl border p-3">
          <h4 className="calendar-summary-heading text-sm font-extrabold">Yaklaşan İşler</h4>
          <p className="mt-1 text-xs opacity-70">Görüntülenen aya ait işlerin konu başlıkları ve açıklamaları</p>
          {monthTasks.length ? (
            <div className="mt-3 space-y-2">
              {monthTasks.slice(0, 12).map(task => (
                <article key={task.id} className="calendar-summary-row rounded-lg px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <h5 className="min-w-0 flex-1 text-sm font-extrabold">{task.title}</h5>
                    <span className="record-branch-badge">{task.branchCode || '---'}</span>
                    <time className="shrink-0 text-xs font-semibold">{task.date} · {task.time}</time>
                  </div>
                  {task.description && (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 opacity-80">{task.description}</p>
                  )}
                </article>
              ))}
            </div>
          ) : <p className="mt-3 text-xs opacity-70">Bu ay için yaklaşan iş bulunmuyor.</p>}
        </section>

        <section className="calendar-summary-panel rounded-xl border p-3">
          <h4 className="calendar-summary-heading text-sm font-extrabold">Önemli Günler</h4>
          <p className="mt-1 text-xs opacity-70">Görüntülenen aya ait önemli günler ve açıklamaları</p>
          {monthImportantDates.length ? (
            <div className="mt-3 space-y-2">
              {monthImportantDates.map(({ date, item }) => (
                <article key={`${date}-${item.title}`} className="calendar-summary-row rounded-lg px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <h5 className="min-w-0 flex-1 text-sm font-extrabold">{item.title}</h5>
                    <time className="shrink-0 text-xs font-semibold">{date}</time>
                  </div>
                  <p className="mt-1 text-xs leading-5 opacity-80">{item.description}</p>
                  <span className="mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-bold">
                    {item.category === 'official' ? 'Resmî Tatil / Bayram' : 'Önemli Gün'}
                  </span>
                </article>
              ))}
            </div>
          ) : <p className="mt-3 text-xs opacity-70">Bu ay için önemli gün bulunmuyor.</p>}
        </section>
      </div>

    </div>
  );
}

function MonthCalendar({
  year,
  month,
  today,
  selected,
  tasksByDate,
  importantByDate,
  onSelect,
}: {
  year: number;
  month: number;
  today: string;
  selected: string | null;
  tasksByDate: Map<string, Task[]>;
  importantByDate: ReturnType<typeof importantDateMap>;
  onSelect: (date: string | null) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];

  for (let index = 0; index < startWeekday; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {TURKISH_DAYS.map((day) => (
          <div key={day} className="py-1 text-center text-xs font-semibold text-slate-500">
            {day.slice(0, 3)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <div key={`empty-${index}`} />;
          const dateKey = dateStr(date);
          const dayTasks = tasksByDate.get(dateKey) ?? [];
          const hasTasks = dayTasks.length > 0;
          const topPriority = getTopPriority(dayTasks);
          const importantDays = importantByDate.get(dateKey) ?? [];
          const importantTitle = importantDays.map(item => `${item.title} — ${item.category === 'official' ? 'Resmî Tatil' : 'Önemli Gün'}\n${item.description}`).join('\n\n');

          return (
            <div
              key={dateKey}
              title={[importantTitle, hasTasks ? getTaskTitle(dayTasks) : ''].filter(Boolean).join('\n\n') || undefined}
              className={`operis-calendar-day relative flex aspect-square cursor-default items-center justify-center rounded-lg text-sm transition ${
                dateKey === today ? 'is-today' : ''
              } ${selected === dateKey ? 'is-selected' : ''} ${
                importantDays.length ? 'bg-lime-300/25 ring-2 ring-lime-300 shadow-[0_0_14px_rgba(190,242,100,0.45)]' : ''
              }`}
              role={hasTasks ? 'button' : undefined}
              tabIndex={hasTasks ? 0 : -1}
              onClick={(event) => { event.stopPropagation(); if (hasTasks) onSelect(selected === dateKey ? null : dateKey); }}
              onKeyDown={(event) => {
                if (hasTasks && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onSelect(selected === dateKey ? null : dateKey);
                }
              }}
              style={
                hasTasks
                  ? {
                      backgroundColor: `${PRIORITY_COLORS[topPriority]}33`,
                      color: 'var(--calendar-active-text, #fff)',
                      boxShadow: `inset 0 0 0 1px ${PRIORITY_COLORS[topPriority]}77`,
                    }
                  : { color: 'var(--calendar-muted-text, #94a3b8)' }
              }
            >
              <span className={dateKey === today ? 'font-bold underline decoration-sky-400 decoration-2 underline-offset-2' : ''}>
                {date.getDate()}
              </span>
              {hasTasks && (
                <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[topPriority] }} />
              )}
              {selected === dateKey && hasTasks && (
                <div className="absolute bottom-full left-1/2 z-30 mb-2 w-52 -translate-x-1/2 rounded-xl bg-slate-900 p-3 shadow-xl ring-1 ring-slate-700 animate-fade-in">
                  <p className="mb-1.5 flex items-center gap-1 text-xs text-slate-400">
                    <Info className="h-3 w-3" />
                    {formatTurkishDay(date)}
                  </p>
                  <div className="space-y-1.5">
                    {dayTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
                        <span className="truncate text-xs text-white">{task.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-slate-500">{task.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function YearCalendar({
  year,
  today,
  tasksByDate,
  importantByDate,
  onOpenMonth,
  compact,
}: {
  year: number;
  today: string;
  tasksByDate: Map<string, Task[]>;
  importantByDate: ReturnType<typeof importantDateMap>;
  onOpenMonth: (month: number) => void;
  compact: boolean;
}) {
  return (
    <div className={`grid gap-2 ${compact ? 'max-h-[620px] grid-cols-2 overflow-y-auto pr-1 lg:grid-cols-3 xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
      {TURKISH_MONTHS.map((monthName, monthIndex) => {
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const startWeekday = new Date(year, monthIndex, 1).getDay();
        const cells: (number | null)[] = [];
        for (let index = 0; index < startWeekday; index += 1) cells.push(null);
        for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
        while (cells.length < 42) cells.push(null);

        return (
          <section key={monthName} className={`rounded-xl bg-slate-900/40 ring-1 ring-slate-700/50 ${compact ? 'p-2' : 'p-3'}`}>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onOpenMonth(monthIndex); }}
              className="mb-2 w-full rounded-lg py-1 text-center text-sm font-bold text-white transition hover:bg-sky-500/20 hover:text-sky-300"
              title={`${monthName} ayını aç`}
            >
              {monthName}
            </button>
            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {TURKISH_DAYS.map((day) => (
                <span key={day} className="text-center text-[9px] font-semibold text-slate-500">{day.slice(0, 1)}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 [grid-auto-rows:18px]">
              {cells.map((day, index) => {
                if (!day) return <span key={`empty-${index}`} className="h-[18px]" />;
                const date = new Date(year, monthIndex, day);
                const dateKey = dateStr(date);
                const dayTasks = tasksByDate.get(dateKey) ?? [];
                const hasTasks = dayTasks.length > 0;
                const topPriority = getTopPriority(dayTasks);
                const importantDays = importantByDate.get(dateKey) ?? [];
                const importantTitle = importantDays.map(item => `${item.title} — ${item.category === 'official' ? 'Resmî Tatil' : 'Önemli Gün'}\n${item.description}`).join('\n\n');
                return (
                  <button
                    key={dateKey}
                    type="button"
                    title={[importantTitle, hasTasks ? getTaskTitle(dayTasks) : `${day} ${monthName} ${year}`].filter(Boolean).join('\n\n')}
                    onClick={(event) => { event.stopPropagation(); onOpenMonth(monthIndex); }}
                    className={`operis-calendar-day relative flex h-[18px] items-center justify-center rounded text-[10px] transition ${
                      dateKey === today ? 'is-today font-bold ring-1 ring-sky-400' : ''
                    } ${importantDays.length ? 'bg-lime-300/30 ring-1 ring-lime-300 shadow-[0_0_8px_rgba(190,242,100,0.5)]' : ''} ${
                      hasTasks ? 'hover:scale-110' : 'hover:bg-slate-800/60'
                    }`}
                    style={
                      hasTasks
                        ? {
                            backgroundColor: `${PRIORITY_COLORS[topPriority]}33`,
                            color: 'var(--calendar-active-text, #fff)',
                          }
                        : { color: 'var(--calendar-muted-text, #94a3b8)' }
                    }
                  >
                    {day}
                    {hasTasks && (
                      <span className="absolute bottom-0.5 h-1 w-1 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[topPriority] }} />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
