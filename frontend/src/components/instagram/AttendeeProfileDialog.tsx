import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Instagram } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AttendeeAvatar from "./AttendeeAvatar";

interface AttendeeProfile {
  id: string;
  name?: string;
  provider_id?: string;
  picture_url?: string;
  profile_url?: string;
  is_self?: boolean;
  specifics?: {
    username?: string;
    biography?: string;
    full_name?: string;
    follower_count?: number;
    following_count?: number;
  };
}

interface AttendeeProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendeeId: string | null;
  displayName?: string;
}

export default function AttendeeProfileDialog({ open, onOpenChange, attendeeId, displayName }: AttendeeProfileDialogProps) {
  const [profile, setProfile] = useState<AttendeeProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && attendeeId) {
      fetchProfile(attendeeId);
    }
  }, [open, attendeeId]);

  const fetchProfile = async (id: string) => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // functions.invoke uses the canonical client URL (6.3); query rides in name.
      const { data, error } = await supabase.functions.invoke(
        `unipile-proxy?action=get-attendee&attendee_id=${id}`,
        { method: "GET" },
      );

      if (!error && data) {
        setProfile(data as AttendeeProfile);
      }
    } catch (err) {
      console.error("Failed to fetch attendee profile:", err);
    } finally {
      setLoading(false);
    }
  };

  const username = profile?.specifics?.username || profile?.provider_id;
  const bio = profile?.specifics?.biography;
  const fullName = profile?.specifics?.full_name || profile?.name || displayName;
  const profileUrl = profile?.profile_url || (username ? `https://instagram.com/${username}` : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="sr-only">Profile Details</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <AttendeeAvatar
              attendeeId={attendeeId || undefined}
              displayName={fullName || undefined}
              className="w-20 h-20 text-lg"
            />

            <div className="text-center space-y-1">
              {fullName && (
                <p className="font-semibold text-foreground">{fullName}</p>
              )}
              {username && (
                <p className="text-sm text-muted-foreground">@{username}</p>
              )}
            </div>

            {bio && (
              <p className="text-sm text-muted-foreground text-center max-w-[280px] leading-relaxed">
                {bio}
              </p>
            )}

            <div className="flex gap-2">
              <Badge variant="secondary" className="gap-1">
                <Instagram className="w-3 h-3" />
                Instagram
              </Badge>
              {profile?.specifics?.follower_count != null && (
                <Badge variant="outline">
                  {profile.specifics.follower_count.toLocaleString()} followers
                </Badge>
              )}
            </div>

            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View on Instagram
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
