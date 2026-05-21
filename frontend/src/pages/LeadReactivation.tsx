import React from 'react';
import { useParams } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { RefreshCw, Phone, MessageSquare, Mail, Users, Target, CalendarCheck, Send, TrendingUp } from '@/components/icons';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import { useReactivationData } from '@/hooks/useReactivationData';
import { usePageHeader } from '@/contexts/PageHeaderContext';

// Channel colors
const CHANNEL_COLORS = {
  phone: { main: 'hsl(200, 70%, 50%)', bg: 'hsl(200, 70%, 50%, 0.08)', border: 'hsl(200, 70%, 50%, 0.40)' },
  sms: { main: 'hsl(153, 40%, 45%)', bg: 'hsl(153, 40%, 45%, 0.08)', border: 'hsl(153, 40%, 45%, 0.40)' },
  email: { main: 'hsl(33, 80%, 50%)', bg: 'hsl(33, 80%, 50%, 0.08)', border: 'hsl(33, 80%, 50%, 0.40)' },
};

const PIE_COLORS = [CHANNEL_COLORS.phone.main, CHANNEL_COLORS.sms.main, CHANNEL_COLORS.email.main];

const formatNum = (n: number) => n.toLocaleString();

const LeadReactivation = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { totals, monthlyData, clientData, loading, refresh } = useReactivationData(clientId);

  usePageHeader({ title: 'Lead Reactivation' });

  const handleRefresh = () => {
    refresh();
  };

  const hasData = totals.totalLeads > 0;

  // Chart data
  const monthlyPositiveData = monthlyData.map(m => ({
    month: m.month,
    Phone: m.callPositive,
    SMS: m.smsPositive,
    Email: m.emailPositive,
  }));

  const monthlyBookingsData = monthlyData.map(m => ({
    month: m.month,
    Phone: m.callBookings,
    SMS: m.smsBookings,
    Email: m.emailBookings,
  }));

  const monthlySendsData = monthlyData.map(m => ({
    month: m.month,
    Calls: m.callsMade,
    SMS: m.smsSent,
    Emails: m.emailsSent,
  }));

  const positiveByChannel = [
    { name: 'Phone', value: totals.callPositive },
    { name: 'SMS', value: totals.smsPositive },
    { name: 'Email', value: totals.emailPositive },
  ];

  const bookingsByChannel = [
    { name: 'Phone', value: totals.callBookings },
    { name: 'SMS', value: totals.smsBookings },
    { name: 'Email', value: totals.emailBookings },
  ];

  const responseRates = [
    { channel: 'Phone (Pickup)', rate: totals.callPickupRate },
    { channel: 'SMS', rate: totals.smsResponseRate },
    { channel: 'Email', rate: totals.emailResponseRate },
  ];

  const positiveIntentRates = [
    { channel: 'Phone', rate: totals.callPositiveRate, label: '% of Pickups' },
    { channel: 'SMS', rate: totals.smsPositiveRate, label: '% of Responses' },
    { channel: 'Email', rate: totals.emailPositiveRate, label: '% of Responses' },
  ];

  const bookingConversionRates = [
    { channel: 'Phone', rate: totals.callBookingRate },
    { channel: 'SMS', rate: totals.smsBookingRate },
    { channel: 'Email', rate: totals.emailBookingRate },
  ];

  const tooltipStyle = {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 0,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center">
        <Button variant="default" size="sm" onClick={handleRefresh} disabled={loading} className="!h-8">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          REFRESH
        </Button>
      </div>

      {/* Bug 4 — empty-state banner when no reactivation runs exist yet */}
      {!hasData && !loading && (
        <div className="border border-border bg-card rounded-md p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">No reactivation data yet.</strong> When this client runs reactivation campaigns (Bug 6 lead-row Reactivate button, Bug 11 /debug-inject-lead, or a CampaignCreate flow), the metrics here will populate from <code>engagement_executions(kind='reactivation')</code> joined with <code>cadence_metrics</code>. All charts render zeros below until a run lands.
        </div>
      )}

      {/* Top-level Stats */}
      <div className="stat-row">
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">LEADS UPLOADED</div>
          <div style={{ fontSize: '24px' }} className="font-light">{formatNum(totals.totalLeads)}</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">TOTAL SENDS</div>
          <div style={{ fontSize: '24px' }} className="font-light">{formatNum(totals.totalSends)}</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">TOTAL RESPONSES</div>
          <div style={{ fontSize: '24px' }} className="font-light">{formatNum(totals.totalResponses)}</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">POSITIVE RESPONSES</div>
          <div style={{ fontSize: '24px' }} className="font-light text-[hsl(var(--success))]">{formatNum(totals.totalPositive)}</div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">MEETINGS BOOKED</div>
          <div style={{ fontSize: '24px' }} className="font-light">{formatNum(totals.totalBookings)}</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">CLIENTS</div>
          <div style={{ fontSize: '24px' }} className="font-light">{totals.clients}</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">OVERALL RESPONSE RATE</div>
          <div style={{ fontSize: '24px' }} className="font-light">{((totals.totalResponses / totals.totalSends) * 100).toFixed(1)}%</div>
        </div>
        <div className="stat-cell">
          <div style={{ fontSize: '11px' }} className="font-medium text-muted-foreground mb-2 uppercase tracking-wide">BOOKING RATE</div>
          <div style={{ fontSize: '24px' }} className="font-light">{((totals.totalBookings / totals.totalPositive) * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Channel Breakdown Cards */}
      <div className="grid grid-cols-3 gap-6">
        {/* Phone */}
        <div className="border bg-card p-4 space-y-3" style={{ borderColor: CHANNEL_COLORS.phone.border, backgroundColor: CHANNEL_COLORS.phone.bg }}>
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" style={{ color: CHANNEL_COLORS.phone.main }} />
            <span style={{ fontSize: '11px' }} className="font-medium uppercase tracking-wide" >PHONE CALLS</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Calls Made</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.callsMade)}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Pickups</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.callPickups)} <span className="text-xs text-muted-foreground">({totals.callPickupRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Positive Intent</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.callPositive)} <span className="text-xs text-muted-foreground">({totals.callPositiveRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Bookings</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.callBookings)} <span className="text-xs text-muted-foreground">({totals.callBookingRate}%)</span></div>
            </div>
          </div>
        </div>

        {/* SMS */}
        <div className="border bg-card p-4 space-y-3" style={{ borderColor: CHANNEL_COLORS.sms.border, backgroundColor: CHANNEL_COLORS.sms.bg }}>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" style={{ color: CHANNEL_COLORS.sms.main }} />
            <span style={{ fontSize: '11px' }} className="font-medium uppercase tracking-wide">SMS</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Messages Sent</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.smsSent)}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Responses</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.smsResponses)} <span className="text-xs text-muted-foreground">({totals.smsResponseRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Positive Intent</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.smsPositive)} <span className="text-xs text-muted-foreground">({totals.smsPositiveRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Bookings</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.smsBookings)} <span className="text-xs text-muted-foreground">({totals.smsBookingRate}%)</span></div>
            </div>
          </div>
        </div>

        {/* Email */}
        <div className="border bg-card p-4 space-y-3" style={{ borderColor: CHANNEL_COLORS.email.border, backgroundColor: CHANNEL_COLORS.email.bg }}>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4" style={{ color: CHANNEL_COLORS.email.main }} />
            <span style={{ fontSize: '11px' }} className="font-medium uppercase tracking-wide">EMAIL</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Emails Sent</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.emailsSent)}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Responses</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.emailResponses)} <span className="text-xs text-muted-foreground">({totals.emailResponseRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Positive Intent</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.emailPositive)} <span className="text-xs text-muted-foreground">({totals.emailPositiveRate}%)</span></div>
            </div>
            <div>
              <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide">Bookings</div>
              <div style={{ fontSize: '20px' }} className="font-light">{formatNum(totals.emailBookings)} <span className="text-xs text-muted-foreground">({totals.emailBookingRate}%)</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Response & Conversion Rates - Horizontal Bar Charts */}
      <div className="grid grid-cols-3 gap-6">
        {/* Response Rates */}
        <div className="border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">RESPONSE RATES</span>
          </div>
          <div className="p-4 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={responseRates} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 20]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Rate']} />
                <Bar dataKey="rate" fill={CHANNEL_COLORS.phone.main} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Positive Intent Rates */}
        <div className="border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">POSITIVE INTENT RATES</span>
          </div>
          <div className="p-4 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={positiveIntentRates} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 25]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} width={60} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Rate']} />
                <Bar dataKey="rate" fill={CHANNEL_COLORS.sms.main} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Booking Conversion Rates */}
        <div className="border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-muted-foreground" />
            <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">BOOKING CONVERSION RATES</span>
          </div>
          <div className="p-4 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bookingConversionRates} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 40]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
                <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} width={60} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Rate']} />
                <Bar dataKey="rate" fill={CHANNEL_COLORS.email.main} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Donut Charts - Positive Responses & Bookings by Channel */}
      <div className="grid grid-cols-2 gap-6">
        <div className="border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">POSITIVE RESPONSES BY CHANNEL</span>
          </div>
          <div className="p-4 h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie data={positiveByChannel} cx="50%" cy="47%" innerRadius={55} outerRadius={85} dataKey="value" stroke="hsl(var(--border))" strokeWidth={1}>
                  {positiveByChannel.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatNum(v), 'Responses']} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', paddingTop: 0, marginTop: -8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-muted-foreground" />
            <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">BOOKINGS BY CHANNEL</span>
          </div>
          <div className="p-4 h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie data={bookingsByChannel} cx="50%" cy="47%" innerRadius={55} outerRadius={85} dataKey="value" stroke="hsl(var(--border))" strokeWidth={1}>
                  {bookingsByChannel.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatNum(v), 'Bookings']} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', paddingTop: 0, marginTop: -8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly Positive Responses - Line Chart */}
      <div className="border border-border bg-card">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">POSITIVE RESPONSES (LAST 12 MONTHS)</span>
        </div>
        <div className="p-4 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyPositiveData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
              <Line type="monotone" dataKey="Phone" stroke={CHANNEL_COLORS.phone.main} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="SMS" stroke={CHANNEL_COLORS.sms.main} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Email" stroke={CHANNEL_COLORS.email.main} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly Bookings - Stacked Bar Chart */}
      <div className="border border-border bg-card">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-muted-foreground" />
          <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">MEETINGS BOOKED (LAST 12 MONTHS)</span>
        </div>
        <div className="p-4 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyBookingsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={{ stroke: 'hsl(var(--border))' }} tickLine={false} width={30} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
              <Bar dataKey="Phone" stackId="a" fill={CHANNEL_COLORS.phone.main} />
              <Bar dataKey="SMS" stackId="a" fill={CHANNEL_COLORS.sms.main} />
              <Bar dataKey="Email" stackId="a" fill={CHANNEL_COLORS.email.main} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Client Breakdown Table */}
      <div className="border border-border bg-card">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">PERFORMANCE BY CLIENT ({totals.clients} CLIENTS)</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Client</TableHead>
              <TableHead className="text-xs text-right">Leads</TableHead>
              <TableHead className="text-xs text-right">Calls</TableHead>
              <TableHead className="text-xs text-right">Pickups</TableHead>
              <TableHead className="text-xs text-right">SMS Sent</TableHead>
              <TableHead className="text-xs text-right">SMS Replies</TableHead>
              <TableHead className="text-xs text-right">Emails</TableHead>
              <TableHead className="text-xs text-right">Email Replies</TableHead>
              <TableHead className="text-xs text-right">Positive</TableHead>
              <TableHead className="text-xs text-right">Bookings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientData.map(c => {
              const totalPositive = c.callPositive + c.smsPositive + c.emailPositive;
              const totalBookings = c.callBookings + c.smsBookings + c.emailBookings;
              return (
                <TableRow key={c.client}>
                  <TableCell className="font-medium text-xs">{c.client}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.totalLeads)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.callsMade)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.callPickups)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.smsSent)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.smsResponses)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.emailsSent)}</TableCell>
                  <TableCell className="text-right text-xs">{formatNum(c.emailResponses)}</TableCell>
                  <TableCell className="text-right text-xs font-medium text-[hsl(var(--success))]">{formatNum(totalPositive)}</TableCell>
                  <TableCell className="text-right text-xs font-medium">{formatNum(totalBookings)}</TableCell>
                </TableRow>
              );
            })}
            {/* Totals row */}
            <TableRow className="bg-muted/30 font-medium">
              <TableCell className="font-medium text-xs">TOTAL</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.totalLeads)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.callsMade)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.callPickups)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.smsSent)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.smsResponses)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.emailsSent)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.emailResponses)}</TableCell>
              <TableCell className="text-right text-xs font-medium text-[hsl(var(--success))]">{formatNum(totals.totalPositive)}</TableCell>
              <TableCell className="text-right text-xs font-medium">{formatNum(totals.totalBookings)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Funnel Summary */}
      <div className="border border-border bg-card">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Send className="w-4 h-4 text-muted-foreground" />
          <span style={{ fontSize: '11px' }} className="font-medium text-muted-foreground uppercase tracking-wide">REACTIVATION FUNNEL</span>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-0">
            {[
              { label: 'LEADS UPLOADED', value: formatNum(totals.totalLeads), width: '100%' },
              { label: 'TOTAL SENDS', value: formatNum(totals.totalSends), width: '85%' },
              { label: 'RESPONSES', value: formatNum(totals.totalResponses), width: '45%' },
              { label: 'POSITIVE INTENT', value: formatNum(totals.totalPositive), width: '22%' },
              { label: 'BOOKINGS', value: formatNum(totals.totalBookings), width: '12%' },
            ].map((step, i) => (
              <div key={i} className="flex-1 text-center">
                <div style={{ fontSize: '11px' }} className="text-muted-foreground uppercase tracking-wide mb-1">{step.label}</div>
                <div style={{ fontSize: '20px' }} className="font-light mb-2">{step.value}</div>
                <div className="mx-1 h-3" style={{
                  backgroundColor: `hsl(var(--success) / ${0.15 + (i * 0.18)})`,
                  border: '1px solid hsl(var(--success) / 0.3)',
                }} />
                {i < 4 && (
                  <div style={{ fontSize: '10px' }} className="text-muted-foreground mt-1">
                    {i === 0 ? '' : `${((parseInt(step.value.replace(/,/g, '')) / totals.totalLeads) * 100).toFixed(1)}%`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeadReactivation;
