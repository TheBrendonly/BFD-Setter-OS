// Public demo callback page — /g/:slug
//
// The prospect submits name + email + mobile; Gary rings them back within about
// a minute, qualifies, and books on a real calendar. This is the outbound
// speed-to-lead demo that replaced the old ring-a-number surface.
//
// Deliberately NOT built on demo_pages / PublicDemoPage: that system is a
// Meta-ads creative simulator whose Voice AI tab is a static ring-a-number
// widget, which is the pattern this page exists to move away from.

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getDemoProspectCopy } from '@/data/demoProspects';
import { requestDemoCallback, validateLocally } from '@/lib/demoCallback';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';
import { Check, PhoneCall, ShieldCheck } from 'lucide-react';

type Status = 'idle' | 'submitting' | 'done';

const DemoCallbackPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const prospect = useMemo(() => getDemoProspectCopy(slug), [slug]);

  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  // Unlisted by design: this URL is handed out one prospect at a time.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (prospect) document.title = `${prospect.firmName} · Gary demo`;
  }, [prospect]);

  if (!prospect) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Demo not found</h1>
          <p className="field-text text-on-surface-variant mt-2">
            This demo link isn't active. Check the link or ask for a new one.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const request = { slug: prospect.slug, firstName, email, phone };
    const localError = validateLocally(request);
    if (localError) {
      setError(localError);
      return;
    }

    setStatus('submitting');
    const result = await requestDemoCallback(request, {
      endpoint: edgeFunctionUrl('demo-callback'),
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
    });

    if (result.ok) {
      setStatus('done');
      return;
    }
    setStatus('idle');
    setError(result.error);
  };

  const submitting = status === 'submitting';

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:items-start">
          {/* Pitch */}
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-primary font-semibold">
              {prospect.eyebrow}
            </p>

            <h1 className="mt-4 text-3xl sm:text-4xl lg:text-[2.75rem] font-semibold leading-[1.12] text-on-surface">
              {prospect.headline}
            </h1>

            <p className="mt-5 field-text text-on-surface-variant leading-relaxed max-w-xl">
              {prospect.subhead}
            </p>

            <ul className="mt-8 space-y-3">
              {prospect.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                    <Check className="h-3 w-3 text-primary" />
                  </span>
                  <span className="field-text text-on-surface">{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Form */}
          <div className="material-surface p-6 sm:p-8">
            {status === 'done' ? (
              <div className="py-6 text-center space-y-4">
                <div className="flex justify-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                    <PhoneCall className="h-6 w-6 text-primary" />
                  </span>
                </div>
                <p className="mobile-heading-2 font-semibold text-on-surface">
                  Gary is calling you now
                </p>
                <p className="field-text text-on-surface-variant">
                  Keep your phone handy. It usually rings within a minute. If you miss it, he'll
                  text you.
                </p>
              </div>
            ) : (
              <>
                <h2 className="mobile-heading-2 font-semibold text-on-surface">
                  Have Gary call you
                </h2>
                <p className="field-text text-on-surface-variant mt-1">
                  Takes about two minutes on the phone.
                </p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                  <div className="space-y-1">
                    <Label htmlFor="firstName" className="field-text font-medium text-on-surface">
                      First name
                    </Label>
                    <Input
                      id="firstName"
                      name="given-name"
                      autoComplete="given-name"
                      placeholder="Gayle"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="modern-input"
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="email" className="field-text font-medium text-on-surface">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@yourfirm.com.au"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="modern-input"
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="phone" className="field-text font-medium text-on-surface">
                      Mobile
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="0400 000 000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="modern-input"
                      disabled={submitting}
                    />
                  </div>

                  {error && (
                    <p role="alert" className="field-text text-destructive">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="material-button-primary modern-button-primary w-full py-3 mobile-touch"
                  >
                    {submitting ? 'Connecting…' : 'Call me now'}
                  </Button>
                </form>
              </>
            )}

            <p className="mt-6 flex items-start gap-2 text-xs text-on-surface-variant leading-relaxed">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Australian mobiles only. Gary will tell you he's AI and that the call is recorded.
                Your details are used for this demo and nothing else.
              </span>
            </p>
          </div>
        </div>

        <p className="mt-16 text-center text-xs text-on-surface-variant">
          A demonstration by Building Flow Digital
        </p>
      </div>
    </div>
  );
};

export default DemoCallbackPage;
