import { useEffect, useRef, useState } from "react";

import { ArrowRight, Check, ChevronLeft, Lock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import PhoneInputComponent from "react-phone-number-input";
import "react-phone-number-input/style.css";
import logo from "@/assets/bfd-logo.png";

const LAUNCH_DATE = new Date("2026-04-16T14:00:00-04:00");
const WEBHOOK_1 = "https://services.leadconnectorhq.com/hooks/dzTOfajR3YuQKAqE1myz/webhook-trigger/3aa90d78-9fc1-43fe-b147-ae578a6d2bd3";
const WEBHOOK_2 = "https://services.leadconnectorhq.com/hooks/dzTOfajR3YuQKAqE1myz/webhook-trigger/0cc0717a-9d4a-4636-b57a-f35df8c81c76";

const CHANNEL_OPTIONS = ["Text", "Voice", "Both"];
const USE_CASE_OPTIONS = [
  "Book Appointments",
  "Qualify & Transfer to Human",
  "Answer Questions / Customer Support",
  "Engage & Connect",
];
const CLIENT_COUNT_OPTIONS = ["1–5", "6–15", "16–50", "50+"];
const REVENUE_OPTIONS = [
  "$0 – $20k",
  "$20k – $50k",
  "$50k – $100k",
  "$100k – $300k",
  "$300k – $1M",
  "$1M – $3M",
  "$3M+",
];

type Step = "info" | "questions" | "video";

function getTimeLeft() {
  const diff = Math.max(0, LAUNCH_DATE.getTime() - Date.now());

  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft());

  useEffect(() => {
    const id = window.setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return timeLeft;
}

interface ChoiceCardProps {
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}

function ChoiceCard({ title, description, selected, onClick }: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative w-full bg-card p-3 text-left transition-colors duration-100 groove-border",
        !selected && "hover:bg-muted/50",
      )}
    >
      {selected && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            border: "1px solid hsl(var(--primary))",
            boxShadow:
              "inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)",
          }}
        />
      )}

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "waitlist-choice-checkbox mt-px flex h-5 w-5 shrink-0 items-center justify-center groove-border",
            selected ? "bg-primary text-primary-foreground" : "bg-card text-transparent",
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0">
          <p className={cn("field-text text-foreground sm:!text-[13px] !text-[14px]", selected && "text-primary")}>{title}</p>
          {description && <p className="field-text mt-1 text-muted-foreground sm:!text-[13px] !text-[14px]">{description}</p>}
        </div>
      </div>
    </button>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <p className="field-text text-foreground sm:!text-[13px] !text-[14px]">{title}</p>;
}

export default function Home() {
  const [step, setStep] = useState<Step>("info");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const [userType, setUserType] = useState<"agency" | "business" | "">("");
  const [channels, setChannels] = useState<string[]>([]);
  const [useCases, setUseCases] = useState<string[]>([]);
  const [otherUseCase, setOtherUseCase] = useState("");
  const [showOtherField, setShowOtherField] = useState(false);
  const [clientCount, setClientCount] = useState("");
  const [hasClients, setHasClients] = useState<"yes" | "no" | "">("");
  const [revenue, setRevenue] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");

  const [submittingStep1, setSubmittingStep1] = useState(false);
  const [submittingStep2, setSubmittingStep2] = useState(false);

  const countdown = useCountdown();
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step !== "video") {
      if (videoRef.current) videoRef.current.innerHTML = "";
      return;
    }

    const container = videoRef.current;
    if (!container) return;

    container.innerHTML = "";

    const embedDiv = document.createElement("div");
    embedDiv.id = "vidalytics_embed_TYq4D5QI1f8VsFvT";
    embedDiv.style.width = "100%";
    embedDiv.style.position = "relative";
    embedDiv.style.paddingTop = "56.25%";
    container.appendChild(embedDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text = `
      (function (v, i, d, a, l, y, t, c, s) {
        y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl+'Script'],vlf=v[c][vl+'Loaded'],ve='Embed';
        if(!vsl){vsl=function(u,cb){if(t){cb();return;}s=i.createElement("script");s.type="text/javascript";s.async=1;s.src=u;if(s.readyState){s.onreadystatechange=function(){if(s.readyState==="loaded"||s.readyState=="complete"){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}i.getElementsByTagName("head")[0].appendChild(s);};}
        vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});
      })(window, document, 'Vidalytics', 'vidalytics_embed_TYq4D5QI1f8VsFvT', 'https://fast.vidalytics.com/embeds/waknFKgn/TYq4D5QI1f8VsFvT/');
    `;

    document.body.appendChild(script);

    return () => {
      script.remove();
      container.innerHTML = "";
    };
  }, [step]);

  const handleStep1Submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) return;

    setSubmittingStep1(true);

    try {
      await fetch(WEBHOOK_1, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        }),
      });
    } catch (error) {
      console.error("Webhook 1 error:", error);
    }

    setSubmittingStep1(false);
    setStep("questions");
  };

  const step2Valid =
    !!userType &&
    !!businessDescription.trim() &&
    channels.length > 0 &&
    (useCases.length > 0 || (showOtherField && otherUseCase.trim())) &&
    !!revenue &&
    (userType !== "agency" || (!!hasClients && (hasClients !== "yes" || !!clientCount)));

  const handleStep2Submit = async () => {
    if (!step2Valid) return;
    setSubmittingStep2(true);

    try {
      const useCaseList = showOtherField ? [...useCases, otherUseCase].filter(Boolean) : useCases;
      const payload: Record<string, string | undefined> = {
        email,
        business_type: userType,
        business_description: businessDescription.trim() || undefined,
        has_clients: userType === "agency" ? hasClients : undefined,
        client_amount: userType === "agency" && hasClients === "yes" ? clientCount : undefined,
        channel: channels.join(", "),
        use_case: useCaseList.join(", "),
        revenue,
      };

      await fetch(WEBHOOK_2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Webhook 2 error:", error);
    }

    setSubmittingStep2(false);
    setStep("video");
  };

  const toggleMulti = (value: string, list: string[], setter: (value: string[]) => void) => {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const countdownItems = [
    { value: countdown.days, label: "Days" },
    { value: countdown.hours, label: "Hours" },
    { value: countdown.minutes, label: "Min" },
    { value: countdown.seconds, label: "Sec" },
  ];

  return (
    <div className="dark flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground font-body">
      {/* ── Header ── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-border bg-sidebar">
        <div className="relative mx-auto flex max-w-7xl items-center justify-center px-4 py-2 sm:px-6">
          <img src={logo} alt="BFD-setter" className="h-11 w-auto" />
          <div className="absolute right-4 sm:right-6 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => window.location.href = '/auth'}
            >
              LOGIN
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {step === "video" ? (
          /* ── Video step ── */
          <section className="px-3 pb-16 sm:px-6" style={{ paddingTop: "104px" }}>
            <div className="mx-auto max-w-3xl">
              <h1 className="text-center text-[34px] leading-[0.94] sm:text-[54px]">
                WATCH THIS VIDEO TO COMPLETE THE PROCESS.
              </h1>

              <div className="mt-6 overflow-hidden groove-border bg-card">
                <div ref={videoRef} className="w-full" />
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* ── Hero ── */}
            <section className="px-4 sm:px-6 pt-[84px] sm:pt-[108px]">
              <div className="mx-auto max-w-4xl text-center">
                <Badge
                  variant="success"
                  className="mx-auto w-fit animate-pulse cursor-pointer"
                  onClick={() => {
                    const formEl = document.getElementById("waitlist-form");
                    if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  JOIN WAITLIST NOW
                </Badge>

                <h1 className="mt-3 text-[42px] leading-[0.94] sm:text-[54px]">
                  OPEN-SOURCE APPOINTMENT SETTER™
                </h1>

                <p className="mx-auto mt-3 max-w-2xl text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', lineHeight: '1.5' }}>
                  First appointment setter your clients can trust. Comes with lead simulation
                  engine, enterprise-grade analytics and built-in client reporting.
                </p>
              </div>
            </section>

            {/* ── Countdown ── */}
            <section className="px-4 mt-6 sm:px-6">
              <div className="mx-auto max-w-xl">
                <div className="grid grid-cols-4 gap-2 sm:gap-3">
                  {countdownItems.map((item) => (
                    <div key={item.label} className="bg-card p-3 text-center groove-border">
                      <p className="font-display text-[30px] leading-none text-foreground sm:text-[34px]">
                        {String(item.value).padStart(2, "0")}
                      </p>
                      <p className="field-text mt-1 text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-center text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                  April 16, 2026 · 2:00 PM ET
                </p>
              </div>
            </section>

            {/* ── Form ── */}
            <section className="px-4 mt-6 sm:px-6" style={{ paddingBottom: '48px' }}>
              <div id="waitlist-form" className="relative mx-auto max-w-2xl border border-border bg-card p-4 pt-[31px] pb-[31px] sm:p-6 sm:pt-6 sm:pb-6">
                <p className="absolute top-2 right-3 text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
                  {step === "info" ? "Step 1 of 2" : "Step 2 of 2"}
                </p>
                {step === "info" && (
                  <div className="space-y-6 sm:space-y-[22px]">
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-[22px]">
                      <div>
                        <Label className="mb-2.5 block field-text text-foreground sm:!text-[13px] !text-[14px]">First Name *</Label>
                        <Input
                          value={firstName}
                          onChange={(event) => setFirstName(event.target.value)}
                          placeholder="Elon"
                        />
                      </div>

                      <div>
                        <Label className="mb-2.5 block field-text text-foreground sm:!text-[13px] !text-[14px]">Last Name *</Label>
                        <Input
                          value={lastName}
                          onChange={(event) => setLastName(event.target.value)}
                          placeholder="Musk"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="mb-2.5 block field-text text-foreground sm:!text-[13px] !text-[14px]">Email *</Label>
                      <Input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="elon@tesla.com"
                      />
                    </div>

                    <div>
                      <Label className="mb-2.5 block field-text text-foreground sm:!text-[13px] !text-[14px]">Phone *</Label>
                      <PhoneInputComponent
                        defaultCountry="US"
                        value={phone}
                        onChange={(value) => setPhone(value || '')}
                        className="phone-input-groove"
                      />
                    </div>

                    <Button
                      className="w-full groove-border"
                      onClick={handleStep1Submit}
                      disabled={
                        !firstName.trim() ||
                        !lastName.trim() ||
                        !email.trim() ||
                        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
                        !phone.replace(/\D/g, '').slice(phone.replace(/\D/g, '').length > 10 ? phone.replace(/\D/g, '').length - 10 : 0).length ||
                        phone.replace(/[^0-9]/g, '').length < 5 ||
                        submittingStep1
                      }
                    >
                      {submittingStep1 ? "SUBMITTING..." : "CONTINUE"}
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                {step === "questions" && (
                  <div>
                    {/* Agency or Business */}
                    <div className="space-y-2">
                      <SectionHeading title="Are you an agency or a business? *" />

                      <div className="space-y-2">
                        <ChoiceCard
                          title="Agency"
                          description="You want to deploy the setter for client accounts."
                          selected={userType === "agency"}
                          onClick={() => {
                            setUserType("agency");
                            setHasClients("");
                            setClientCount("");
                          }}
                        />

                        <ChoiceCard
                          title="Business"
                          description="You want to use the setter inside your own business."
                          selected={userType === "business"}
                          onClick={() => {
                            setUserType("business");
                            setHasClients("");
                            setClientCount("");
                          }}
                        />
                      </div>
                    </div>

                    {/* Agency sub-questions */}
                    {userType === "agency" && (
                      <>
                        <div className="my-5 border-t border-dashed border-border" />
                        <div className="space-y-2">
                          <SectionHeading title="Do you currently have clients? *" />

                          <div className="space-y-2">
                            <ChoiceCard
                              title="No, I'm Starting Out"
                              selected={hasClients === "no"}
                              onClick={() => setHasClients("no")}
                            />

                            <ChoiceCard
                              title="Yes"
                              selected={hasClients === "yes"}
                              onClick={() => setHasClients("yes")}
                            />
                          </div>
                        </div>

                        {hasClients === "yes" && (
                          <>
                            <div className="my-5 border-t border-dashed border-border" />
                            <div className="space-y-2">
                              <SectionHeading title="How many clients do you have? *" />

                              <div className="space-y-2">
                                {CLIENT_COUNT_OPTIONS.map((count) => (
                                  <ChoiceCard
                                    key={count}
                                    title={count}
                                    selected={clientCount === count}
                                    onClick={() => setClientCount(count)}
                                  />
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    <div className="my-5 border-t border-dashed border-border" />

                    {/* Business Description */}
                    <div className="space-y-2">
                      <SectionHeading title="In a few words, what does your business do? *" />
                      <textarea
                        value={businessDescription}
                        onChange={(event) => setBusinessDescription(event.target.value)}
                        placeholder="e.g. Digital marketing agency for dental clinics"
                        rows={3}
                        className="flex w-full groove-border bg-card px-3 py-2 field-text text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary resize-none sm:!text-[13px] !text-[14px]"
                      />
                    </div>

                    <div className="my-5 border-t border-dashed border-border" />

                    {/* Channels */}
                    <div className="space-y-2">
                      <SectionHeading title="What channel are you mostly interested in? *" />

                      <div className="space-y-2">
                        {CHANNEL_OPTIONS.map((channel) => (
                          <ChoiceCard
                            key={channel}
                            title={channel}
                            selected={channels.includes(channel)}
                            onClick={() => toggleMulti(channel, channels, setChannels)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="my-5 border-t border-dashed border-border" />

                    {/* Use cases */}
                    <div className="space-y-2">
                      <SectionHeading title="What is your use case? *" />

                      <div className="space-y-2">
                        {USE_CASE_OPTIONS.map((useCase) => (
                          <ChoiceCard
                            key={useCase}
                            title={useCase}
                            selected={useCases.includes(useCase)}
                            onClick={() => toggleMulti(useCase, useCases, setUseCases)}
                          />
                        ))}

                        <ChoiceCard
                          title="Other"
                          description="Describe your use case."
                          selected={showOtherField}
                          onClick={() => setShowOtherField((value) => !value)}
                        />
                      </div>

                      {showOtherField && (
                        <Input
                          value={otherUseCase}
                          onChange={(event) => setOtherUseCase(event.target.value)}
                          placeholder="Describe your use case..."
                        />
                      )}
                    </div>

                    <div className="my-5 border-t border-dashed border-border" />

                    {/* Revenue */}
                    <div className="space-y-2">
                      <SectionHeading title="What is your current business revenue? *" />

                      <div className="space-y-2">
                        {REVENUE_OPTIONS.map((value) => (
                          <ChoiceCard
                            key={value}
                            title={value}
                            selected={revenue === value}
                            onClick={() => setRevenue(value)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="my-5 border-t border-dashed border-border" />

                    {/* Actions */}
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button onClick={() => setStep("info")} className="sm:min-w-[140px] groove-border">
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                        BACK
                      </Button>

                      <Button
                        className="sm:flex-1 groove-btn-positive"
                        onClick={handleStep2Submit}
                        disabled={!step2Valid || submittingStep2}
                      >
                        {submittingStep2 ? "SUBMITTING..." : "SUBMIT"}
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-border bg-sidebar px-6 py-4">
        <p className="field-text text-center text-muted-foreground">
          © {new Date().getFullYear()} 1PROMPT.COM. ALL RIGHTS RESERVED
        </p>
      </footer>
    </div>
  );
}
