import { useState, useEffect } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AttendeeAvatarProps {
  attendeeId?: string;
  displayName?: string;
  className?: string;
  onClick?: (e?: React.MouseEvent) => void;
}

export default function AttendeeAvatar({ attendeeId, displayName, className = "w-8 h-8", onClick }: AttendeeAvatarProps) {
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!attendeeId) return;
    loadPicture(attendeeId);
  }, [attendeeId]);

  // Revoke the object URL when it changes (cleanup runs with the previous value)
  // and on unmount, so blob-backed image bytes aren't leaked per list row.
  useEffect(() => {
    return () => {
      if (pictureUrl) URL.revokeObjectURL(pictureUrl);
    };
  }, [pictureUrl]);

  const loadPicture = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // functions.invoke decodes an image content-type response to a Blob; the
      // query string rides in the function name (6.3: avoids undefined.supabase.co).
      const { data, error } = await supabase.functions.invoke(
        `unipile-proxy?action=get-attendee-picture&attendee_id=${id}`,
        { method: "GET" },
      );

      if (!error && data instanceof Blob) {
        setPictureUrl(URL.createObjectURL(data));
      }
    } catch {
      // silently fail - will show fallback
    }
  };

  const initials = displayName
    ? displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "";

  return (
    <Avatar
      className={`${className} shrink-0 ${onClick ? "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all" : ""}`}
      onClick={onClick}
    >
      {pictureUrl && <AvatarImage src={pictureUrl} alt={displayName || "Profile"} />}
      <AvatarFallback className="bg-muted text-muted-foreground text-xs">
        {initials || <User className="w-4 h-4" />}
      </AvatarFallback>
    </Avatar>
  );
}
