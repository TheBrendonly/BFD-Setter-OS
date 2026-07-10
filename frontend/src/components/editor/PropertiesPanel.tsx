import { CanvasState, PageSection, Creative } from '@/types/editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Upload, Trash2, Plus } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PropertiesPanelProps {
  canvasState: CanvasState;
  selectedElement: string | null;
  onUpdateProperty: (sectionId: string, key: string, value: any) => void;
  onUpdateSection: (sectionId: string, updates: Partial<PageSection>) => void;
}

export default function PropertiesPanel({
  canvasState,
  selectedElement,
  onUpdateProperty,
  onUpdateSection,
}: PropertiesPanelProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const selectedSection = canvasState.sections.find(s => s.id === selectedElement);

  if (!selectedSection) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p className="text-sm">Select an element to edit its properties</p>
      </div>
    );
  }

  const handleImageUpload = async (file: File, propertyKey: string) => {
    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('demo-creatives')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('demo-creatives')
        .getPublicUrl(filePath);

      onUpdateProperty(selectedSection.id, propertyKey, publicUrl);

      toast({
        title: 'Success',
        description: 'Image uploaded successfully',
      });
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload image',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const renderProperties = () => {
    const props = selectedSection.properties;

    switch (selectedSection.type) {
      case 'header':
        return (
          <div className="space-y-4">
            <div>
              <Label>Logo</Label>
              <div className="mt-2">
                {props.logoUrl ? (
                  <div className="space-y-2">
                    <img src={props.logoUrl} alt="Logo" className="h-16 object-contain" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdateProperty(selectedSection.id, 'logoUrl', '')}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = (e: any) => {
                        const file = e.target.files[0];
                        if (file) handleImageUpload(file, 'logoUrl');
                      };
                      input.click();
                    }}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Logo
                  </Button>
                )}
              </div>
            </div>
          </div>
        );

      case 'voiceAISection':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              All styling and content is edited directly in the preview. Use this panel for webhook configuration.
            </p>
            <div>
              <Label>Webhook URL</Label>
              <Input
                type="url"
                value={props.webhookUrl || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'webhookUrl', e.target.value)}
                placeholder="https://your-webhook-host.com/webhook/..."
              />
              <p className="text-xs text-muted-foreground mt-1">
                When users request a call, their details (name, email, phone) will be sent to this webhook
              </p>
            </div>
          </div>
        );

      case 'textAISection':
        return (
          <div className="space-y-4">
            <div>
              <Label>Section Title</Label>
              <Input
                value={props.heading || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'heading', e.target.value)}
              />
            </div>
            <div>
              <Label>Section Subtitle</Label>
              <Textarea
                value={props.subheading || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'subheading', e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label>Company Name</Label>
              <Input
                value={props.companyName || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'companyName', e.target.value)}
              />
            </div>
            <div>
              <Label>Webhook URL</Label>
              <Input
                value={props.webhookUrl || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'webhookUrl', e.target.value)}
                placeholder="https://your-webhook-endpoint.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Messages will be sent to this webhook for AI response
              </p>
            </div>
          </div>
        );

      case 'formAISection':
        const creatives = (props.creatives as Creative[]) || [];
        
        const handleAddCreative = () => {
          if (creatives.length >= 4) {
            toast({
              title: 'Limit reached',
              description: 'Maximum 4 creatives allowed',
              variant: 'destructive',
            });
            return;
          }
          
          const newCreative: Creative = {
            id: `creative-${Date.now()}`,
            format: '1:1',
            imageUrl: '',
            title: 'New Ad Title',
            subtitle: 'Your headline here',
            ctaText: 'Learn More',
            description: 'Description text',
            logo: props.companyPageLogo || '',
            name: props.companyPageName || 'Company Name'
          };
          onUpdateProperty(selectedSection.id, 'creatives', [...creatives, newCreative]);
        };

        const handleUpdateCreative = (index: number, field: string, value: any) => {
          const newCreatives = [...creatives];
          newCreatives[index] = { ...newCreatives[index], [field]: value };
          onUpdateProperty(selectedSection.id, 'creatives', newCreatives);
        };

        const handleDeleteCreative = (index: number) => {
          const newCreatives = creatives.filter((_, i) => i !== index);
          onUpdateProperty(selectedSection.id, 'creatives', newCreatives);
        };

        const handleCreativeImageUpload = async (file: File, index: number) => {
          setUploading(true);
          try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from('demo-creatives')
              .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
              .from('demo-creatives')
              .getPublicUrl(filePath);

            handleUpdateCreative(index, 'imageUrl', publicUrl);

            toast({
              title: 'Success',
              description: 'Image uploaded successfully',
            });
          } catch (error: any) {
            console.error('Error uploading image:', error);
            toast({
              title: 'Error',
              description: 'Failed to upload image',
              variant: 'destructive',
            });
          } finally {
            setUploading(false);
          }
        };

        return (
          <div className="space-y-4">
            <div>
              <Label>Section Title</Label>
              <Input
                value={props.heading || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'heading', e.target.value)}
              />
            </div>
            <div>
              <Label>Section Subtitle</Label>
              <Textarea
                value={props.subheading || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'subheading', e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label>Company Page Name</Label>
              <Input
                value={props.companyPageName || ''}
                onChange={(e) => onUpdateProperty(selectedSection.id, 'companyPageName', e.target.value)}
              />
            </div>
            <div>
              <Label>Company Page Logo</Label>
              {props.companyPageLogo ? (
                <div className="space-y-2 mt-2">
                  <img src={props.companyPageLogo} alt="Company" className="h-12 w-12 rounded-full object-cover" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdateProperty(selectedSection.id, 'companyPageLogo', '')}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e: any) => {
                      const file = e.target.files[0];
                      if (file) handleImageUpload(file, 'companyPageLogo');
                    };
                    input.click();
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Logo
                </Button>
              )}
            </div>

            {/* Creatives Management */}
            <div className="space-y-4 border-t pt-4 mt-6">
              <div className="flex items-center justify-between">
                <Label>Meta Ad Creatives ({creatives.length}/4)</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddCreative}
                  disabled={creatives.length >= 4}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Creative
                </Button>
              </div>

              {creatives.map((creative, index) => (
                <div key={creative.id} className="border rounded-lg p-4 space-y-3 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Creative {index + 1}</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCreative(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div>
                    <Label className="text-xs">Ad Format</Label>
                    <Select
                      value={creative.format}
                      onValueChange={(value: '1:1' | '3:4' | '9:16') => handleUpdateCreative(index, 'format', value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1:1">Square (1:1)</SelectItem>
                        <SelectItem value="3:4">Feed (3:4)</SelectItem>
                        <SelectItem value="9:16">Reel (9:16)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Ad Image</Label>
                    {creative.imageUrl ? (
                      <div className="mt-2 space-y-2">
                        <img 
                          src={creative.imageUrl} 
                          alt={creative.title} 
                          className="w-full h-32 object-cover rounded"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = (e: any) => {
                              const file = e.target.files[0];
                              if (file) handleCreativeImageUpload(file, index);
                            };
                            input.click();
                          }}
                        >
                          Change Image
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full"
                        disabled={uploading}
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = (e: any) => {
                            const file = e.target.files[0];
                            if (file) handleCreativeImageUpload(file, index);
                          };
                          input.click();
                        }}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Image
                      </Button>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input
                      value={creative.title}
                      onChange={(e) => handleUpdateCreative(index, 'title', e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Subtitle/Headline</Label>
                    <Input
                      value={creative.subtitle}
                      onChange={(e) => handleUpdateCreative(index, 'subtitle', e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={creative.description || ''}
                      onChange={(e) => handleUpdateCreative(index, 'description', e.target.value)}
                      className="mt-1"
                      rows={2}
                    />
                  </div>

                  <div>
                    <Label className="text-xs">CTA Button Text</Label>
                    <Input
                      value={creative.ctaText}
                      onChange={(e) => handleUpdateCreative(index, 'ctaText', e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return (
          <div className="p-4 text-muted-foreground">
            <p className="text-sm">No properties available</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold">Properties</h3>
        <div className="flex items-center justify-between pt-2">
          <Label htmlFor="section-visibility" className="text-sm">Section Visible</Label>
          <Switch
            id="section-visibility"
            checked={selectedSection.visible}
            onCheckedChange={(checked) => 
              onUpdateSection(selectedSection.id, { visible: checked })
            }
          />
        </div>
      </div>
      <div className="p-6 space-y-6">
        {renderProperties()}
      </div>
    </div>
  );
}
