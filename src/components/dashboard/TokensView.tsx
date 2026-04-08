import { useId, useMemo, useState } from "react";
import {
  format,
  subHours,
  subDays,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  eachDayOfInterval,
  isWithinInterval,
} from "date-fns";
import { CreditCard, ChevronRight } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CallTask } from "@/components/dashboard/ConversationView";

function numFromPayload(p: Record<string, unknown> | undefined, key: string): number | null {
  if (!p) return null;
  const v = p[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Per-call consumed tokens (input + output, or total_tokens when present). */
export function tokensConsumedForTask(task: CallTask): number {
  const p = task.payload;
  const totalTok = numFromPayload(p, "total_tokens");
  if (totalTok != null) return totalTok;
  const inTok = numFromPayload(p, "input_tokens");
  const outTok = numFromPayload(p, "output_tokens");
  if (inTok != null && outTok != null) return inTok + outTok;
  if (inTok != null) return inTok;
  if (outTok != null) return outTok;
  return 0;
}

export type TimeRangeKey = "24h" | "7d" | "30d" | "90d" | "all";

function taskInRange(task: CallTask, range: TimeRangeKey, now: Date): boolean {
  if (range === "all") return true;
  const t = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
  const start =
    range === "24h"
      ? subHours(now, 24)
      : range === "7d"
        ? subDays(now, 7)
        : range === "30d"
          ? subDays(now, 30)
          : subDays(now, 90);
  return t >= start && t <= now;
}

function sumTokens(tasks: CallTask[]): number {
  return tasks.reduce((acc, task) => acc + tokensConsumedForTask(task), 0);
}

function intervalBounds(range: TimeRangeKey, now: Date): { start: Date; end: Date } {
  const end = now;
  if (range === "all") return { start: subDays(now, 89), end };
  if (range === "24h") return { start: subHours(now, 24), end };
  if (range === "7d") return { start: subDays(now, 7), end };
  if (range === "30d") return { start: subDays(now, 30), end };
  return { start: subDays(now, 90), end };
}

/** Daily series for sparklines (tokens per calendar day within the chart window). */
function buildDailyTokenSeries(
  tasks: CallTask[],
  range: TimeRangeKey,
  now: Date,
): { day: string; tokens: number }[] {
  const filtered = tasks.filter((task) => taskInRange(task, range, now));
  const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
  const byDay = new Map<string, number>();
  for (const task of filtered) {
    const d = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
    const k = dayKey(d);
    byDay.set(k, (byDay.get(k) ?? 0) + tokensConsumedForTask(task));
  }

  const { start: intervalStart, end: intervalEnd } = intervalBounds(range, now);
  const dayList = eachDayOfInterval({ start: intervalStart, end: intervalEnd });
  return dayList.map((d) => {
    const k = dayKey(d);
    return { day: k, tokens: byDay.get(k) ?? 0 };
  });
}

function buildDailyCallCountSeries(
  tasks: CallTask[],
  range: TimeRangeKey,
  now: Date,
): { day: string; count: number }[] {
  const tokenSeries = buildDailyTokenSeries(tasks, range, now);
  const filtered = tasks.filter((task) => taskInRange(task, range, now));
  const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
  const byDay = new Map<string, number>();
  for (const task of filtered) {
    const d = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
    const k = dayKey(d);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  return tokenSeries.map(({ day }) => ({
    day,
    count: byDay.get(day) ?? 0,
  }));
}

function monthToDateTokens(tasks: CallTask[], now: Date): number {
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  return tasks.reduce((acc, task) => {
    const d = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
    if (!isWithinInterval(d, { start, end })) return acc;
    return acc + tokensConsumedForTask(task);
  }, 0);
}

function parseEnvNumber(key: string, fallback: number): number {
  const raw = import.meta.env[key as keyof ImportMetaEnv];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const RANGE_OPTIONS: { key: TimeRangeKey; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "All" },
];

function MiniSparkline({
  data,
  dataKey,
  color,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  color: string;
}) {
  const gid = useId().replace(/:/g, "");
  if (data.length === 0) {
    return <div className="h-10 w-full rounded-md bg-muted/40" />;
  }
  return (
    <div className="h-10 w-full -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
          <defs>
            <linearGradient id={`tok-spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis hide dataKey="day" />
          <YAxis hide domain={["auto", "auto"]} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#tok-spark-${gid})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniBarHighlight({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-10 flex items-end gap-1 rounded-md bg-muted/30 px-2 pb-1">
      <div
        className="w-full max-w-[48px] rounded-sm bg-[hsl(262_83%_58%)] transition-all"
        style={{ height: `${Math.max(12, pct)}%` }}
      />
    </div>
  );
}

export interface TokensViewProps {
  callTasks: CallTask[];
  /** Optional: parent switches to Settings (e.g. API / call backend). */
  onOpenSettings?: () => void;
  /** Remaining free call requests from backend (authoritative when available). */
  freeTrialRemaining?: number | null;
  /** Trial cap used for fallback estimate from call count. */
  freeTrialLimit?: number;
}

export function TokensView({
  callTasks,
  onOpenSettings,
  freeTrialRemaining = null,
  freeTrialLimit = 5,
}: TokensViewProps) {
  const [range, setRange] = useState<TimeRangeKey>("30d");
  const now = useMemo(() => new Date(), []);

  const allTimeTotalTokens = useMemo(() => sumTokens(callTasks), [callTasks]);

  const tasksInRange = useMemo(
    () => callTasks.filter((t) => taskInRange(t, range, now)),
    [callTasks, range, now],
  );

  const periodTotalTokens = useMemo(() => sumTokens(tasksInRange), [tasksInRange]);
  const callCountInRange = tasksInRange.length;
  const responsesCount = callCountInRange;

  const tokenSparkData = useMemo(
    () => buildDailyTokenSeries(callTasks, range, now),
    [callTasks, range, now],
  );
  const requestSparkData = useMemo(
    () => buildDailyCallCountSeries(callTasks, range, now),
    [callTasks, range, now],
  );

  const monthlyBudget = parseEnvNumber("VITE_MONTHLY_TOKEN_BUDGET", 20_000_000);
  const usedMonthToDate = useMemo(() => monthToDateTokens(callTasks, now), [callTasks, now]);
  const budgetPct = monthlyBudget > 0 ? Math.min(100, (usedMonthToDate / monthlyBudget) * 100) : 0;

  const creditUsd = import.meta.env.VITE_CREDIT_BALANCE_USD;
  const creditDisplay =
    creditUsd !== undefined && String(creditUsd).trim() !== ""
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
          Number(creditUsd),
        )
      : "—";

  const resetsInDays = Math.max(0, differenceInCalendarDays(endOfMonth(now), now));

  const maxDayCalls = Math.max(1, ...requestSparkData.map((d) => d.count));
  const estimatedTrialRemaining = Math.max(0, freeTrialLimit - callTasks.length);
  const visibleTrialRemaining =
    typeof freeTrialRemaining === "number" ? Math.max(0, freeTrialRemaining) : estimatedTrialRemaining;

  return (
    <div className="flex-1 overflow-y-auto bg-[hsl(250_25%_98%)]">
      <div className="max-w-6xl mx-auto w-full px-6 py-8 space-y-8">
        {/* All-time total — sum of every call’s consumption */}
        <div className="rounded-2xl border border-border/60 bg-card px-6 py-5 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Free trial requests remaining</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
            {visibleTrialRemaining.toLocaleString()} / {freeTrialLimit.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Uses backend value after a successful call; otherwise estimated from total call requests.
          </p>
        </div>

        {/* All-time total — sum of every call’s consumption */}
        <div className="rounded-2xl border border-border/60 bg-card px-6 py-6 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Total tokens</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
            {allTimeTotalTokens.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            All calls combined — input + output consumed across your entire history (not affected by the
            time range below).
          </p>
        </div>

        {/* Toolbar — matches usage dashboard pattern */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-foreground">Usage</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {RANGE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRange(key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    range === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Metric grid */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-5">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <span>Total tokens ({RANGE_OPTIONS.find((r) => r.key === range)?.label})</span>
                <ChevronRight className="h-4 w-4 opacity-50" />
              </button>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">
                {periodTotalTokens.toLocaleString()}
              </p>
              <MiniSparkline data={tokenSparkData} dataKey="tokens" color="hsl(262 83% 58%)" />
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-5">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <span>Responses and Chat Completions</span>
                <ChevronRight className="h-4 w-4 opacity-50" />
              </button>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">
                {responsesCount.toLocaleString()}
              </p>
              <MiniBarHighlight value={responsesCount} max={Math.max(1, callCountInRange, 10)} />
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Month budget</p>
              <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">
                {usedMonthToDate.toLocaleString()} / {monthlyBudget.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">tokens (calendar month)</p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500/90 transition-all"
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Resets in {resetsInDays} day{resetsInDays === 1 ? "" : "s"}.{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => onOpenSettings?.()}
                >
                  Edit budget
                </button>
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Credit balance</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{creditDisplay}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4 gap-2" disabled>
                <CreditCard className="h-4 w-4" />
                Add credits
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Wide row — total requests */}
        <Card className="border-border/80 shadow-sm">
          <CardContent className="p-5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Total requests</span>
              <ChevronRight className="h-4 w-4 opacity-50" />
            </button>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-foreground">
              {callCountInRange.toLocaleString()}
            </p>
            <div className="mt-4 h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={requestSparkData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-req" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(262 83% 58%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(262 83% 58%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis hide dataKey="day" />
                  <YAxis hide domain={[0, maxDayCalls]} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(262 83% 58%)"
                    strokeWidth={1.5}
                    fill="url(#grad-req)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {callTasks.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground pb-8">
            No calls yet — totals will update when your call backend reports usage on tasks.
          </p>
        ) : null}
      </div>
    </div>
  );
}
