import { PageSection } from '@/types/editor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, Loader2 } from '@/components/icons';
import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { nanoid } from 'nanoid';

const countryCodes = [
  { code: '+1', country: 'US/CA', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
  { code: '+55', country: 'BR', flag: '🇧🇷' },
  { code: '+52', country: 'MX', flag: '🇲🇽' },
  { code: '+34', country: 'ES', flag: '🇪🇸' },
  { code: '+39', country: 'IT', flag: '🇮🇹' },
  { code: '+82', country: 'KR', flag: '🇰🇷' },
  { code: '+31', country: 'NL', flag: '🇳🇱' },
  { code: '+46', country: 'SE', flag: '🇸🇪' },
  { code: '+41', country: 'CH', flag: '🇨🇭' },
  { code: '+65', country: 'SG', flag: '🇸🇬' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+966', country: 'SA', flag: '🇸🇦' },
  { code: '+27', country: 'ZA', flag: '🇿🇦' },
];

interface SectionProps {
  section: PageSection;
  isSelected: boolean;
  isEditor: boolean;
  onSelect: () => void;
  onUpdateProperty: (key: string, value: any) => void;
}

export default function VoiceAISection({ section, isEditor, onUpdateProperty }: SectionProps) {
  const props = section.properties;
  const { toast } = useToast();

  // Master state object - sync with props
  const [voiceConfig, setVoiceConfig] = useState({
    title: props.heading || 'Test Your Voice AI Agent',
    titleSize: parseInt(props.headingFontSize) || 32,
    titleColor: props.headingColor || '#000000',
    subtitle: props.subheading || 'Click the button below to call our AI agent',
    subtitleSize: parseInt(props.subheadingFontSize) || 18,
    subtitleColor: props.subheadingColor || '#666666',
    phoneNumber: props.phoneNumber || '',
    webhookUrl: props.webhookUrl || '',
    buttonText: props.buttonText || 'Request a Call',
    buttonBgColor: props.buttonBackgroundColor || '#1976d2',
    buttonTextColor: props.buttonTextColor || '#ffffff',
    buttonStrokeColor: props.buttonStrokeColor || '#1976d2',
    buttonStrokeWidth: parseInt(props.buttonStrokeWidth) || 0,
    buttonRadius: parseInt(props.buttonBorderRadius) || 8,
    buttonSize: parseInt(props.buttonFontSize) || 16,
  });

  // Form state for public view
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    countryCode: '+1',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync voiceConfig with props when they change (for display only)
  useEffect(() => {
    setVoiceConfig({
      title: props.heading || 'Test Your Voice AI Agent',
      titleSize: parseInt(props.headingFontSize) || 32,
      titleColor: props.headingColor || '#000000',
      subtitle: props.subheading || 'Click the button below to call our AI agent',
      subtitleSize: parseInt(props.subheadingFontSize) || 18,
      subtitleColor: props.subheadingColor || '#666666',
      phoneNumber: props.phoneNumber || '',
      webhookUrl: props.webhookUrl || '',
      buttonText: props.buttonText || 'Request a Call',
      buttonBgColor: props.buttonBackgroundColor || '#1976d2',
      buttonTextColor: props.buttonTextColor || '#ffffff',
      buttonStrokeColor: props.buttonStrokeColor || '#1976d2',
      buttonStrokeWidth: parseInt(props.buttonStrokeWidth) || 0,
      buttonRadius: parseInt(props.buttonBorderRadius) || 8,
      buttonSize: parseInt(props.buttonFontSize) || 16,
    });
  }, [
    props.heading,
    props.headingFontSize,
    props.headingColor,
    props.subheading,
    props.subheadingFontSize,
    props.subheadingColor,
    props.phoneNumber,
    props.webhookUrl,
    props.buttonText,
    props.buttonBackgroundColor,
    props.buttonTextColor,
    props.buttonStrokeColor,
    props.buttonStrokeWidth,
    props.buttonBorderRadius,
    props.buttonFontSize,
  ]);


  // Temporary state objects for editing
  const [tempTitleData, setTempTitleData] = useState({ text: '', size: 32, color: '#000000' });
  const [tempSubtitleData, setTempSubtitleData] = useState({ text: '', size: 18, color: '#666666' });
  const [tempButtonData, setTempButtonData] = useState({
    text: '',
    bgColor: '#1976d2',
    textColor: '#ffffff',
    strokeColor: '#1976d2',
    strokeWidth: 0,
    radius: 8,
    fontSize: 16,
  });

  // Edit mode states
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingSubtitle, setEditingSubtitle] = useState(false);
  const [editingButton, setEditingButton] = useState(false);

  // Refs for auto-focus and auto-resize
  const titleInputRef = useRef<HTMLInputElement>(null);
  const subtitleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const buttonInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingSubtitle && subtitleTextareaRef.current) {
      subtitleTextareaRef.current.focus();
      autoResizeTextarea();
    }
  }, [editingSubtitle]);

  useEffect(() => {
    if (editingButton && buttonInputRef.current) {
      buttonInputRef.current.focus();
    }
  }, [editingButton]);

  // Auto-resize textarea
  const autoResizeTextarea = () => {
    const textarea = subtitleTextareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  };

  useEffect(() => {
    if (editingSubtitle) {
      autoResizeTextarea();
    }
  }, [tempSubtitleData.text, editingSubtitle]);

  const handleRequestCall = async () => {
    // Validate form
    if (!formData.name.trim()) {
      toast({
        title: 'Name Required',
        description: 'Please enter your name',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.email.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter your email',
        variant: 'destructive',
      });
      return;
    }
    if (!formData.phone.trim()) {
      toast({
        title: 'Phone Required',
        description: 'Please enter your phone number',
        variant: 'destructive',
      });
      return;
    }

    if (!voiceConfig.webhookUrl) {
      toast({
        title: 'Configuration Error',
        description: 'Webhook URL not configured',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        id: nanoid(),
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: `${formData.countryCode}${formData.phone.trim()}`,
      };

      // Use the notify-webhook edge function to send the request
      const { data, error } = await supabase.functions.invoke('notify-webhook', {
        body: {
          url: voiceConfig.webhookUrl,
          payload: payload,
        },
      });

      if (error) throw error;

      toast({
        title: 'Request Sent!',
        description: 'We will call you shortly.',
      });

      // Clear form
      setFormData({ name: '', email: '', phone: '', countryCode: '+1' });
    } catch (error: any) {
      console.error('Error sending webhook:', error);
      toast({
        title: 'Error',
        description: 'Failed to send request. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Title handlers
  const enterTitleEdit = () => {
    setTempTitleData({
      text: voiceConfig.title,
      size: voiceConfig.titleSize,
      color: voiceConfig.titleColor,
    });
    setEditingTitle(true);
  };

  const saveTitleEdit = () => {
    // Use temp data directly - call parent update immediately
    onUpdateProperty('heading', tempTitleData.text);
    onUpdateProperty('headingFontSize', `${tempTitleData.size}px`);
    onUpdateProperty('headingColor', tempTitleData.color);
    
    setEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
  };

  // Subtitle handlers
  const enterSubtitleEdit = () => {
    setTempSubtitleData({
      text: voiceConfig.subtitle,
      size: voiceConfig.subtitleSize,
      color: voiceConfig.subtitleColor,
    });
    setEditingSubtitle(true);
  };

  const saveSubtitleEdit = () => {
    // Use temp data directly - call parent update immediately
    onUpdateProperty('subheading', tempSubtitleData.text);
    onUpdateProperty('subheadingFontSize', `${tempSubtitleData.size}px`);
    onUpdateProperty('subheadingColor', tempSubtitleData.color);
    
    setEditingSubtitle(false);
  };

  const cancelSubtitleEdit = () => {
    setEditingSubtitle(false);
  };

  // Button handlers
  const enterButtonEdit = () => {
    setTempButtonData({
      text: voiceConfig.buttonText,
      bgColor: voiceConfig.buttonBgColor,
      textColor: voiceConfig.buttonTextColor,
      strokeColor: voiceConfig.buttonStrokeColor,
      strokeWidth: voiceConfig.buttonStrokeWidth,
      radius: voiceConfig.buttonRadius,
      fontSize: voiceConfig.buttonSize,
    });
    setEditingButton(true);
  };

  const saveButtonEdit = () => {
    // Use temp data directly - call parent update immediately
    onUpdateProperty('buttonText', tempButtonData.text);
    onUpdateProperty('buttonBackgroundColor', tempButtonData.bgColor);
    onUpdateProperty('buttonTextColor', tempButtonData.textColor);
    onUpdateProperty('buttonStrokeColor', tempButtonData.strokeColor);
    onUpdateProperty('buttonStrokeWidth', `${tempButtonData.strokeWidth}px`);
    onUpdateProperty('buttonBorderRadius', `${tempButtonData.radius}px`);
    onUpdateProperty('buttonFontSize', `${tempButtonData.fontSize}px`);
    
    setEditingButton(false);
  };

  const cancelButtonEdit = () => {
    setEditingButton(false);
  };


  if (!isEditor) {
    // Public view
    return (
      <div className="w-full min-h-screen flex items-center justify-center p-8">
        <Card className="max-w-2xl w-full p-8 shadow-xl">
          <div className="flex flex-col items-center text-center">
            <div 
              className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6"
            >
              <Phone className="h-10 w-10 text-primary" />
            </div>

            <h2 
              className="font-bold mb-4" 
              style={{ 
                fontSize: `${voiceConfig.titleSize}px`, 
                color: voiceConfig.titleColor
              }}
            >
              {voiceConfig.title}
            </h2>

            <p 
              className="max-w-xl whitespace-pre-wrap mb-8" 
              style={{ 
                fontSize: `${voiceConfig.subtitleSize}px`, 
                color: voiceConfig.subtitleColor
              }}
            >
              {voiceConfig.subtitle}
            </p>

            {/* Request Call Form */}
            <div className="w-full max-w-md space-y-4">
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Your Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="text-center"
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Your Email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="text-center"
                />
              </div>
              <div className="flex gap-2">
                <Select
                  value={formData.countryCode}
                  onValueChange={(value) => setFormData({ ...formData, countryCode: value })}
                >
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {countryCodes.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.flag} {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="tel"
                  placeholder="Phone Number"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="flex-1"
                />
              </div>

              <button
                onClick={handleRequestCall}
                disabled={isSubmitting}
                className="w-full px-8 py-3 font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  backgroundColor: voiceConfig.buttonBgColor,
                  color: voiceConfig.buttonTextColor,
                  border: `${voiceConfig.buttonStrokeWidth}px solid ${voiceConfig.buttonStrokeColor}`,
                  borderRadius: `${voiceConfig.buttonRadius}px`,
                  fontSize: `${voiceConfig.buttonSize}px`,
                }}
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {voiceConfig.buttonText}
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Editor view
  return (
    <div className="w-full min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Voice AI Configuration</h2>
          <p className="text-muted-foreground">Click on any element below to edit it directly</p>
        </div>

        {/* Webhook URL Field */}
        <Card className="p-6">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={voiceConfig.webhookUrl}
              onChange={(e) => {
                const newUrl = e.target.value;
                setVoiceConfig({ ...voiceConfig, webhookUrl: newUrl });
                onUpdateProperty('webhookUrl', newUrl);
              }}
              placeholder="https://your-webhook-host.com/webhook/..."
            />
            <p className="text-xs text-muted-foreground">
              When users request a call, their details will be sent to this webhook
            </p>
          </div>
        </Card>

        {/* Live Preview */}
        <div className="space-y-2">
          <Label>Live Editable Preview</Label>
          <Card className="p-12 relative">
            <div className="flex flex-col items-center text-center">
              <div 
                className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6"
              >
                <Phone className="h-10 w-10 text-primary" />
              </div>


              {/* Title Editor */}
              {editingTitle ? (
                <div className="w-full max-w-xl space-y-4">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={tempTitleData.text}
                    onChange={(e) => setTempTitleData({ ...tempTitleData, text: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-primary rounded-lg outline-none font-bold text-center"
                    style={{ fontSize: `${tempTitleData.size}px`, color: tempTitleData.color }}
                  />

                  <Card className="p-4 bg-muted/30">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Font Size</Label>
                        <Input
                          type="number"
                          min={12}
                          max={72}
                          value={tempTitleData.size}
                          onChange={(e) => setTempTitleData({ ...tempTitleData, size: parseInt(e.target.value) || 32 })}
                          className="h-8"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={tempTitleData.color}
                            onChange={(e) => setTempTitleData({ ...tempTitleData, color: e.target.value })}
                            className="w-12 h-8 p-1"
                          />
                          <Input
                            type="text"
                            value={tempTitleData.color}
                            onChange={(e) => setTempTitleData({ ...tempTitleData, color: e.target.value })}
                            className="flex-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 justify-center mt-4 pt-4 border-t">
                      <Button onClick={cancelTitleEdit} variant="outline" size="sm">
                        Cancel
                      </Button>
                      <Button onClick={saveTitleEdit} size="sm">
                        Save
                      </Button>
                    </div>
                  </Card>
                </div>
              ) : (
                <h2
                  onClick={enterTitleEdit}
                  className="font-bold cursor-pointer hover:bg-primary/5 rounded-lg px-4 py-2 transition-all mb-4"
                  style={{ 
                    fontSize: `${voiceConfig.titleSize}px`, 
                    color: voiceConfig.titleColor
                  }}
                >
                  {voiceConfig.title}
                </h2>
              )}


              {/* Subtitle Editor */}
              {editingSubtitle ? (
                <div className="w-full max-w-xl space-y-4">
                  <textarea
                    ref={subtitleTextareaRef}
                    value={tempSubtitleData.text}
                    onChange={(e) => setTempSubtitleData({ ...tempSubtitleData, text: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-primary rounded-lg outline-none text-center resize-none overflow-hidden"
                    style={{ fontSize: `${tempSubtitleData.size}px`, color: tempSubtitleData.color, minHeight: '80px' }}
                  />

                  <Card className="p-4 bg-muted/30">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Font Size</Label>
                        <Input
                          type="number"
                          min={10}
                          max={32}
                          value={tempSubtitleData.size}
                          onChange={(e) => setTempSubtitleData({ ...tempSubtitleData, size: parseInt(e.target.value) || 18 })}
                          className="h-8"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={tempSubtitleData.color}
                            onChange={(e) => setTempSubtitleData({ ...tempSubtitleData, color: e.target.value })}
                            className="w-12 h-8 p-1"
                          />
                          <Input
                            type="text"
                            value={tempSubtitleData.color}
                            onChange={(e) => setTempSubtitleData({ ...tempSubtitleData, color: e.target.value })}
                            className="flex-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 justify-center mt-4 pt-4 border-t">
                      <Button onClick={cancelSubtitleEdit} variant="outline" size="sm">
                        Cancel
                      </Button>
                      <Button onClick={saveSubtitleEdit} size="sm">
                        Save
                      </Button>
                    </div>
                  </Card>
                </div>
              ) : (
                <p
                  onClick={enterSubtitleEdit}
                  className="max-w-xl whitespace-pre-wrap cursor-pointer hover:bg-primary/5 rounded-lg px-4 py-2 transition-all mb-8"
                  style={{ 
                    fontSize: `${voiceConfig.subtitleSize}px`, 
                    color: voiceConfig.subtitleColor
                  }}
                >
                  {voiceConfig.subtitle}
                </p>
              )}


              {/* Button Editor */}
              {editingButton ? (
                <div className="w-full max-w-xl space-y-4">
                  {/* Live Preview Button */}
                  <button
                    type="button"
                    className="px-8 py-3 font-medium pointer-events-none"
                    style={{
                      backgroundColor: tempButtonData.bgColor,
                      color: tempButtonData.textColor,
                      border: `${tempButtonData.strokeWidth}px solid ${tempButtonData.strokeColor}`,
                      borderRadius: `${tempButtonData.radius}px`,
                      fontSize: `${tempButtonData.fontSize}px`,
                    }}
                  >
                    {tempButtonData.text}
                  </button>

                  {/* Text Input */}
                  <input
                    ref={buttonInputRef}
                    type="text"
                    value={tempButtonData.text}
                    onChange={(e) => setTempButtonData({ ...tempButtonData, text: e.target.value })}
                    placeholder="Button text"
                    className="w-full px-4 py-2 border-2 border-primary rounded-lg outline-none text-center"
                  />

                  <Card className="p-4 bg-muted/30">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Background Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={tempButtonData.bgColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, bgColor: e.target.value })}
                            className="w-12 h-8 p-1"
                          />
                          <Input
                            type="text"
                            value={tempButtonData.bgColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, bgColor: e.target.value })}
                            className="flex-1 h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Text Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={tempButtonData.textColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, textColor: e.target.value })}
                            className="w-12 h-8 p-1"
                          />
                          <Input
                            type="text"
                            value={tempButtonData.textColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, textColor: e.target.value })}
                            className="flex-1 h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Border Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={tempButtonData.strokeColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, strokeColor: e.target.value })}
                            className="w-12 h-8 p-1"
                          />
                          <Input
                            type="text"
                            value={tempButtonData.strokeColor}
                            onChange={(e) => setTempButtonData({ ...tempButtonData, strokeColor: e.target.value })}
                            className="flex-1 h-8 text-xs"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Border Width</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={tempButtonData.strokeWidth}
                          onChange={(e) => setTempButtonData({ ...tempButtonData, strokeWidth: parseInt(e.target.value) || 0 })}
                          className="h-8"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Border Radius</Label>
                        <Input
                          type="number"
                          min={0}
                          max={50}
                          value={tempButtonData.radius}
                          onChange={(e) => setTempButtonData({ ...tempButtonData, radius: parseInt(e.target.value) || 8 })}
                          className="h-8"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Font Size</Label>
                        <Input
                          type="number"
                          min={10}
                          max={32}
                          value={tempButtonData.fontSize}
                          onChange={(e) => setTempButtonData({ ...tempButtonData, fontSize: parseInt(e.target.value) || 16 })}
                          className="h-8"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 justify-center mt-4 pt-4 border-t">
                      <Button onClick={cancelButtonEdit} variant="outline" size="sm">
                        Cancel
                      </Button>
                      <Button onClick={saveButtonEdit} size="sm">
                        Save
                      </Button>
                    </div>
                  </Card>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={enterButtonEdit}
                  className="px-8 py-3 font-medium transition-all hover:opacity-90 cursor-pointer"
                  style={{
                    backgroundColor: voiceConfig.buttonBgColor,
                    color: voiceConfig.buttonTextColor,
                    border: `${voiceConfig.buttonStrokeWidth}px solid ${voiceConfig.buttonStrokeColor}`,
                    borderRadius: `${voiceConfig.buttonRadius}px`,
                    fontSize: `${voiceConfig.buttonSize}px`,
                  }}
                >
                  {voiceConfig.buttonText}
                </button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

