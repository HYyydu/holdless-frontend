import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Search, ShoppingBag, CreditCard, Upload, X, FileImage, Stethoscope, Zap, Shield, Home, GraduationCap, Plane, Building2, MoreHorizontal, Car, Receipt, Heart, IdCard, Globe, Users, FileText, MessageSquare, ArrowRight, Wand2 } from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGovProfiles, GovProfile } from "@/hooks/useGovProfiles";
import { ProfileSelector } from "@/components/gov-task/ProfileSelector";
import { GovInfoForm } from "@/components/gov-task/GovInfoForm";
import { uploadTaskAttachments, validateTaskAttachment, type TaskAttachment } from "@/lib/taskAttachments";
import { extractBillFields, type ExtractedBillFields } from "@/lib/chatApi";

interface NewTaskDialogProps {
  onCreateTask: (task: any) => void | Promise<void>;
  userId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialDescription?: string;
}

const serviceCategories = [
  { name: "Medical", icon: Stethoscope, color: "bg-red-500", keywords: ["doctor", "hospital", "clinic", "appointment", "prescription", "health", "medical", "pharmacy", "dentist", "therapy", "checkup"] },
  { name: "Utility", icon: Zap, color: "bg-yellow-500", keywords: ["electric", "water", "gas", "power", "utility", "bill", "outage", "internet", "cable", "phone"] },
  { name: "Insurance", icon: Shield, color: "bg-green-500", keywords: ["insurance", "claim", "policy", "coverage", "premium", "deductible", "health insurance", "auto insurance", "life insurance"] },
  { name: "Banking / Finance", icon: CreditCard, color: "bg-blue-500", keywords: ["bank", "credit", "debit", "loan", "mortgage", "payment", "transfer", "account", "finance", "card", "fee", "charge"] },
  { name: "Retail / Commerce", icon: ShoppingBag, color: "bg-orange-500", keywords: ["amazon", "order", "delivery", "refund", "return", "shipping", "package", "store", "purchase", "exchange", "walmart", "target"] },
  { name: "Housing / Real Estate", icon: Home, color: "bg-teal-500", keywords: ["rent", "lease", "apartment", "house", "property", "landlord", "maintenance", "housing", "real estate", "move"] },
  { name: "Education", icon: GraduationCap, color: "bg-purple-500", keywords: ["school", "university", "college", "tuition", "enrollment", "transcript", "course", "student", "financial aid", "education"] },
  { name: "Transportation / Travel", icon: Plane, color: "bg-sky-500", keywords: ["flight", "airline", "hotel", "booking", "reservation", "travel", "uber", "lyft", "train", "bus", "car rental"] },
  { name: "Government / Public Services", icon: Building2, color: "bg-gray-500", keywords: ["dmv", "license", "registration", "passport", "social security", "tax", "government", "irs", "visa", "immigration", "id", "benefits", "plate", "vehicle", "driver"] },
  { name: "Others", icon: MoreHorizontal, color: "bg-slate-500", keywords: [] },
];

// Intent detection logic
const detectServiceCategory = (input: string): { category: typeof serviceCategories[0] | null; confidence: 'high' | 'medium' | 'low'; suggestedIssue?: string; suggestedSubCategory?: string; suggestedSubIssue?: string } => {
  if (!input || input.trim().length < 3) {
    return { category: null, confidence: 'low' };
  }
  
  const lowerInput = input.toLowerCase();
  
  // Check for government-specific patterns first (more specific)
  const govPatterns = [
    { pattern: /license\s*plate\s*(renewal|renew)/i, subCategory: "Vehicle / DMV", subIssue: "License Plate Renewal" },
    { pattern: /driver'?s?\s*license/i, subCategory: "Vehicle / DMV", subIssue: "Driver's License" },
    { pattern: /vehicle\s*registration/i, subCategory: "Vehicle / DMV", subIssue: "Vehicle Registration" },
    { pattern: /dmv\s*(appointment)?/i, subCategory: "Vehicle / DMV", subIssue: "Appointment Scheduling" },
    { pattern: /passport/i, subCategory: "ID / License", subIssue: "Apply or renew ID" },
    { pattern: /social\s*security/i, subCategory: "Social Security", subIssue: "Benefits status" },
    { pattern: /tax\s*(return|refund|filing)/i, subCategory: "Taxes", subIssue: "Tax return status" },
    { pattern: /visa|immigration/i, subCategory: "Immigration / Visa", subIssue: "Application status" },
  ];
  
  for (const { pattern, subCategory, subIssue } of govPatterns) {
    if (pattern.test(lowerInput)) {
      const govCategory = serviceCategories.find(c => c.name === "Government / Public Services")!;
      return { category: govCategory, confidence: 'high', suggestedSubCategory: subCategory, suggestedSubIssue: subIssue };
    }
  }
  
  // Score each category based on keyword matches
  let bestMatch: typeof serviceCategories[0] | null = null;
  let bestScore = 0;
  
  for (const category of serviceCategories) {
    if (category.keywords.length === 0) continue;
    
    let score = 0;
    for (const keyword of category.keywords) {
      if (lowerInput.includes(keyword)) {
        score += keyword.length; // Longer keywords = more specific = higher score
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }
  
  if (bestMatch && bestScore >= 4) {
    return { category: bestMatch, confidence: bestScore >= 8 ? 'high' : 'medium' };
  }
  
  return { category: null, confidence: 'low' };
};

const issueTypes: Record<string, string[]> = {
  "Medical": ["Schedule appointment", "Request prescription refill", "Billing dispute", "Insurance claim", "Medical records request", "Referral request"],
  "Utility": ["Set up service", "Repair request", "Terminate service", "Bill dispute", "Plan change", "Outage report"],
  "Insurance": ["File claim", "Policy inquiry", "Coverage change", "Premium dispute", "Cancel policy", "Add coverage"],
  "Banking / Finance": ["Dispute charge", "Fee reversal", "Account access", "Card replacement", "Payment issue", "Loan inquiry"],
  "Retail / Commerce": ["Return item", "Exchange item", "Shipping delay", "Wrong item", "Damaged package", "Refund request"],
  "Housing / Real Estate": ["Maintenance request", "Lease inquiry", "Rent dispute", "Move-in/out", "Property viewing", "Contract question"],
  "Education": ["Enrollment inquiry", "Tuition payment", "Transcript request", "Course registration", "Financial aid", "Grade dispute"],
  "Transportation / Travel": ["Booking change", "Refund request", "Lost luggage", "Complaint", "Reservation inquiry", "Loyalty program"],
  "Others": ["General inquiry", "Complaint", "Feedback", "Request information", "Schedule appointment", "Other"],
};

const governmentSubCategories: Record<string, string[]> = {
  "Vehicle / DMV": ["Driver's License", "Vehicle Registration", "Title / Ownership", "Appointment Scheduling", "Fees / Penalties", "License Plate Renewal"],
  "Taxes": ["Tax return status", "Payment plan", "Filing help"],
  "Benefits / Assistance": ["Application status", "Eligibility", "Appeal"],
  "ID / License": ["Apply or renew ID", "Replace lost or stolen ID", "Update personal information"],
  "Immigration / Visa": ["Application status", "Appointment scheduling", "Documentation request", "General inquiry"],
  "Social Security": ["Benefits status", "Social Security number issues", "Retirement or disability inquiries"],
  "Public Records": ["Request records", "Records status", "Corrections or updates"],
  "Other / Talk to an Agent": ["Describe your issue"],
};

export function NewTaskDialog({ onCreateTask, userId, open: controlledOpen, onOpenChange, initialDescription }: NewTaskDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  // Support both controlled and uncontrolled modes
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalOpen(value);
    }
  };
  
  const [step, setStep] = useState(1);
  const [taskDescription, setTaskDescription] = useState(initialDescription || "");
  const [searchFilter, setSearchFilter] = useState("");
  const [vendor, setVendor] = useState("");
  const [issue, setIssue] = useState("");
  const [subIssue, setSubIssue] = useState("");
  const [outcome, setOutcome] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [companyProviderName, setCompanyProviderName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [accountOrInvoiceNumber, setAccountOrInvoiceNumber] = useState("");
  const [billDueDate, setBillDueDate] = useState("");
  const [chargeOrServiceDate, setChargeOrServiceDate] = useState("");
  
  // Government service specific fields
  const [govFullName, setGovFullName] = useState("");
  const [govDateOfBirth, setGovDateOfBirth] = useState("");
  const [govState, setGovState] = useState("");
  const [govZipCode, setGovZipCode] = useState("");
  const [govLicenseNumber, setGovLicenseNumber] = useState("");
  const [govLicenseIssueType, setGovLicenseIssueType] = useState("");
  const [govCallGoal, setGovCallGoal] = useState("");

  // Profile management
  const { profiles, addProfile, deleteProfile } = useGovProfiles();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [saveAsProfile, setSaveAsProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  
  // Detected service from user input
  const detectedService = useMemo(() => detectServiceCategory(taskDescription), [taskDescription]);

  // Calculate total steps based on service type
  const totalSteps = vendor === "Government / Public Services" ? 4 : 3;
  
  // Check if government info form is valid (required fields - call goal is now optional)
  const isGovInfoValid = govFullName.trim() !== "" && govDateOfBirth !== "" && govState !== "" && govZipCode.trim() !== "";

  const getIssueTypesForService = (serviceName: string) => {
    return issueTypes[serviceName] || issueTypes["Others"];
  };

  const governmentCategoryIcons: Record<string, React.ElementType> = {
    "Vehicle / DMV": Car,
    "Taxes": Receipt,
    "Benefits / Assistance": Heart,
    "ID / License": IdCard,
    "Immigration / Visa": Globe,
    "Social Security": Users,
    "Public Records": FileText,
    "Other / Talk to an Agent": MessageSquare,
  };

  const handleCreateTask = async () => {
    if (isCreatingTask) return;
    setUploadError(null);
    setIsCreatingTask(true);
    try {
      let attachments: TaskAttachment[] | undefined;
      if (uploadedFiles.length > 0) {
        if (!userId) {
          throw new Error("Please sign in before uploading bill documents.");
        }
        attachments = await uploadTaskAttachments(userId, uploadedFiles);
      }
      let extractedFields: ExtractedBillFields | null = null;
      if (userId && attachments && attachments.length > 0) {
        extractedFields = await extractBillFields(userId, attachments as unknown as Array<Record<string, unknown>>);
      }
      const exInv = extractedFields?.invoiceNumber?.trim();
      const exAcct = extractedFields?.accountNumber?.trim();
      const billDetails = {
        companyProviderName: companyProviderName || extractedFields?.companyProviderName || undefined,
        billAmount: billAmount || extractedFields?.billAmount || undefined,
        invoiceNumber: exInv || undefined,
        accountNumber: exAcct || undefined,
        accountOrInvoiceNumber:
          accountOrInvoiceNumber ||
          (exInv && exAcct ? `${exInv} / ${exAcct}` : exInv || exAcct || extractedFields?.accountOrInvoiceNumber) ||
          undefined,
        billDueDate: billDueDate || extractedFields?.billDueDate || undefined,
        chargeOrServiceDate: chargeOrServiceDate || extractedFields?.chargeOrServiceDate || undefined,
      };
      const newTask = {
        id: Date.now().toString(),
        vendor,
        issue: vendor === "Government / Public Services" ? `${issue} - ${subIssue}` : issue,
        desiredOutcome: vendor === "Government / Public Services" ? govCallGoal : (outcome || undefined),
        orderNumber: orderNumber || undefined,
        attachments,
        billDetails,
        status: 'pending' as const,
        createdAt: new Date(),
        eta: "Starting within 30 minutes"
      };
      await onCreateTask(newTask);
      resetForm();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to upload files.";
      setUploadError(message);
    } finally {
      setIsCreatingTask(false);
    }
  };

  const resetForm = () => {
    setOpen(false);
    setStep(1);
    setVendor("");
    setTaskDescription("");
    setSearchFilter("");
    setIssue("");
    setSubIssue("");
    setOutcome("");
    setOrderNumber("");
    setUploadedFiles([]);
    setCompanyProviderName("");
    setBillAmount("");
    setAccountOrInvoiceNumber("");
    setBillDueDate("");
    setChargeOrServiceDate("");
    // Reset government fields
    setGovFullName("");
    setGovDateOfBirth("");
    setGovState("");
    setGovZipCode("");
    setGovLicenseNumber("");
    setGovLicenseIssueType("");
    setGovCallGoal("");
    // Reset profile fields
    setSelectedProfileId(null);
    setShowProfileForm(false);
    setSaveAsProfile(false);
    setProfileName("");
  };
  
  // Handle smart detection and auto-advance
  const handleSmartDetection = useCallback(() => {
    if (detectedService.category && detectedService.confidence === 'high') {
      setVendor(detectedService.category.name);
      
      // For government services with detected sub-issue, skip step 2
      if (detectedService.category.name === "Government / Public Services" && 
          detectedService.suggestedSubCategory && 
          detectedService.suggestedSubIssue) {
        setIssue(detectedService.suggestedSubCategory);
        setSubIssue(detectedService.suggestedSubIssue);
        setStep(3);
      } else if (detectedService.suggestedIssue) {
        // For other categories with suggested issue, still go to step 2 but pre-select
        setIssue(detectedService.suggestedIssue);
        setStep(2);
      } else {
        setStep(2);
      }
    }
  }, [detectedService]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const nextFiles: File[] = [];
    for (const file of files) {
      const validationError = validateTaskAttachment(file);
      if (validationError) {
        setUploadError(validationError);
        continue;
      }
      nextFiles.push(file);
    }
    if (nextFiles.length > 0) {
      setUploadError(null);
      setUploadedFiles(prev => [...prev, ...nextFiles]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setUploadError(null);
  };

  // Sync initialDescription when it changes
  useEffect(() => {
    if (initialDescription) {
      setTaskDescription(initialDescription);
    }
  }, [initialDescription]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Only show trigger when uncontrolled */}
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button variant="primary" size="lg" className="fixed bottom-6 right-6 rounded-full shadow-glow">
            <Plus className="w-5 h-5" />
            New Task
          </Button>
        </DialogTrigger>
      )}
      
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Create Support Task
            <Badge variant="outline">Step {step} of {totalSteps}</Badge>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {step === 1 && (
            <div>
              <Label className="text-base font-medium">What do you need help with?</Label>
              <p className="text-sm text-muted-foreground mb-4">Describe your task or select a service category</p>
              
              <Tabs defaultValue="describe" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="describe" className="flex items-center gap-2">
                    <Wand2 className="w-4 h-4" />
                    Describe Task
                  </TabsTrigger>
                  <TabsTrigger value="browse" className="flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Browse Services
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="describe" className="space-y-4">
                  <div className="space-y-3">
                    <Textarea
                      placeholder="e.g., DMV license plate renewal appointment, refund for Amazon order, dispute a bank fee..."
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      className="min-h-[100px] resize-none"
                    />
                    
                    {/* Continue button for Step 1 */}
                    {detectedService.category && detectedService.confidence === 'high' && (
                      <div className="flex justify-end pt-2">
                        <Button
                          variant="primary"
                          onClick={() => {
                            setVendor(detectedService.category!.name);
                            
                            if (detectedService.category!.name === "Government / Public Services" && 
                                detectedService.suggestedSubCategory && 
                                detectedService.suggestedSubIssue) {
                              setIssue(detectedService.suggestedSubCategory);
                              setSubIssue(detectedService.suggestedSubIssue);
                              setShowProfileForm(true);
                              setStep(3);
                            } else {
                              setStep(2);
                            }
                          }}
                        >
                          Continue
                          <ArrowRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="browse" className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                    <Input 
                      placeholder="Filter services..." 
                      className="pl-10"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                    />
                  </div>
                  
                  <ScrollArea className="h-[280px]">
                    <div className="grid grid-cols-2 gap-3 p-1 pr-4">
                      {serviceCategories
                        .filter((s) => s.name.toLowerCase().includes(searchFilter.toLowerCase()))
                        .map((s) => (
                          <Card 
                            key={s.name}
                            className={`cursor-pointer transition-smooth hover:shadow-elegant ${
                              vendor === s.name ? 'ring-2 ring-primary ring-offset-2' : ''
                            }`}
                            onClick={() => {
                              setVendor(s.name);
                              setStep(2);
                            }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 ${s.color} rounded-lg flex items-center justify-center`}>
                                  <s.icon className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <h3 className="font-medium">{s.name}</h3>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          )}
          
          {step === 2 && (
            <div>
              <Label className="text-base font-medium">What do you need help with?</Label>
              <p className="text-sm text-muted-foreground mb-4">Select the type of assistance you need for {vendor}</p>
              
              <div className="space-y-4">
                {vendor === "Government / Public Services" ? (
                  <ScrollArea className="h-[340px]">
                    <Accordion 
                      type="single" 
                      collapsible 
                      className="pr-3"
                      value={issue}
                      onValueChange={(value) => {
                        setIssue(value);
                        setSubIssue("");
                      }}
                    >
                      {Object.entries(governmentSubCategories).map(([category, subItems]) => {
                        const IconComponent = governmentCategoryIcons[category] || Building2;
                        return (
                          <AccordionItem key={category} value={category} className="border rounded-lg mb-2 overflow-hidden">
                            <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-primary/5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                                  <IconComponent className="w-4 h-4 text-primary" />
                                </div>
                                <span className="font-medium text-foreground">{category}</span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-4 pb-3">
                              <div className="space-y-1 pt-2 pl-11">
                                {subItems.map((subItem) => (
                                  <button
                                    key={subItem}
                                    onClick={() => setSubIssue(subItem)}
                                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-smooth flex items-center justify-between ${
                                      subIssue === subItem 
                                        ? 'bg-primary text-primary-foreground' 
                                        : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    <span>{subItem}</span>
                                    {subIssue === subItem && (
                                      <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  </ScrollArea>
                ) : (
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-2 pr-3">
                      {getIssueTypesForService(vendor).map((type) => (
                        <button
                          key={type}
                          onClick={() => setIssue(type)}
                          className={`w-full text-left px-4 py-3 rounded-lg border transition-smooth flex items-center justify-between group ${
                            issue === type 
                              ? 'border-primary bg-primary/5 text-primary' 
                              : 'border-border hover:border-primary/40 hover:bg-muted/50'
                          }`}
                        >
                          <span className={`font-medium ${issue === type ? 'text-primary' : 'text-foreground'}`}>
                            {type}
                          </span>
                          {issue === type && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                
                {/* Only show these fields for non-Government services */}
                {vendor !== "Government / Public Services" && (
                  <>
                    <div>
                      <Label htmlFor="order-number">Order Number (Optional)</Label>
                      <Input 
                        id="order-number"
                        placeholder="e.g. 113-1234567-8910112"
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="receipt-upload">Receipt or Order Details (Optional)</Label>
                      <p className="text-xs text-muted-foreground mb-2">Upload screenshots or photos to help us resolve your issue faster</p>
                      
                      <div className="space-y-3">
                        <label 
                          htmlFor="receipt-upload" 
                          className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50 transition-smooth"
                        >
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-primary">Click to upload</span> or drag and drop
                            </p>
                            <p className="text-xs text-muted-foreground">PNG, JPG, PDF up to 10MB</p>
                          </div>
                          <input 
                            id="receipt-upload" 
                            type="file" 
                            className="hidden" 
                            accept="image/*,.pdf"
                            multiple
                            onChange={handleFileUpload}
                          />
                        </label>

                        {uploadedFiles.length > 0 && (
                          <div className="space-y-2">
                            {uploadedFiles.map((file, index) => (
                              <div key={index} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                                <FileImage className="w-5 h-5 text-primary" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{file.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeFile(index)}
                                  className="h-8 w-8 p-0"
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        {uploadError && (
                          <p className="text-xs text-destructive">{uploadError}</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="outcome">Desired Outcome</Label>
                      <Textarea 
                        id="outcome"
                        placeholder="e.g. Full refund for damaged strawberries, no store credit"
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        className="min-h-20"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Bill Details (auto-filled from uploaded files when you start task)</Label>
                      <Input
                        placeholder="Company/provider name"
                        value={companyProviderName}
                        onChange={(e) => setCompanyProviderName(e.target.value)}
                      />
                      <Input
                        placeholder="Bill amount"
                        value={billAmount}
                        onChange={(e) => setBillAmount(e.target.value)}
                      />
                      <Input
                        placeholder="Account number / invoice number"
                        value={accountOrInvoiceNumber}
                        onChange={(e) => setAccountOrInvoiceNumber(e.target.value)}
                      />
                      <Input
                        placeholder="Bill due date"
                        value={billDueDate}
                        onChange={(e) => setBillDueDate(e.target.value)}
                      />
                      <Input
                        placeholder="Date of charge/service"
                        value={chargeOrServiceDate}
                        onChange={(e) => setChargeOrServiceDate(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => {
                  setVendor('');
                  setIssue('');
                  setSubIssue('');
                  setStep(1);
                }}>
                  Back
                </Button>
                <Button 
                  onClick={() => setStep(3)} 
                  disabled={vendor === "Government / Public Services" ? (!issue || !subIssue) : (!issue || !outcome)}
                  variant="primary"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3 for Government Services - Information Collection */}
          {step === 3 && vendor === "Government / Public Services" && (
            <div>
              <Label className="text-base font-medium">{subIssue} Information</Label>
              <p className="text-sm text-muted-foreground mb-4">
                Provide your details to help us assist you
              </p>
              
              <ScrollArea className="h-[420px] pr-3">
                <div className="space-y-4">
                  {/* Profile Selector - Show if not already showing form */}
                  {!showProfileForm && (
                    <ProfileSelector
                      profiles={profiles}
                      selectedProfileId={selectedProfileId}
                      onSelectProfile={(profile) => {
                        if (profile) {
                          setSelectedProfileId(profile.id);
                          setGovFullName(profile.fullName);
                          setGovDateOfBirth(profile.dateOfBirth);
                          setGovState(profile.state);
                          setGovZipCode(profile.zipCode);
                          setShowProfileForm(true);
                        } else {
                          setSelectedProfileId(null);
                        }
                      }}
                      onCreateNew={() => {
                        setSelectedProfileId(null);
                        setGovFullName("");
                        setGovDateOfBirth("");
                        setGovState("");
                        setGovZipCode("");
                        setShowProfileForm(true);
                      }}
                      onDeleteProfile={(id) => {
                        deleteProfile(id);
                        if (selectedProfileId === id) {
                          setSelectedProfileId(null);
                        }
                      }}
                    />
                  )}

                  {/* Show form when profile is selected or user chose to enter new info */}
                  {showProfileForm && (
                    <GovInfoForm
                      fullName={govFullName}
                      setFullName={setGovFullName}
                      dateOfBirth={govDateOfBirth}
                      setDateOfBirth={setGovDateOfBirth}
                      state={govState}
                      setState={setGovState}
                      zipCode={govZipCode}
                      setZipCode={setGovZipCode}
                      licenseNumber={govLicenseNumber}
                      setLicenseNumber={setGovLicenseNumber}
                      licenseIssueType={govLicenseIssueType}
                      setLicenseIssueType={setGovLicenseIssueType}
                      callGoal={govCallGoal}
                      setCallGoal={setGovCallGoal}
                      saveAsProfile={saveAsProfile}
                      setSaveAsProfile={setSaveAsProfile}
                      profileName={profileName}
                      setProfileName={setProfileName}
                      showSaveOption={!selectedProfileId}
                      isEditingExisting={!!selectedProfileId}
                      profiles={profiles}
                      onAutofillFromProfile={(profile) => {
                        setGovFullName(profile.fullName);
                        setGovDateOfBirth(profile.dateOfBirth);
                        setGovState(profile.state);
                        setGovZipCode(profile.zipCode);
                      }}
                    />
                  )}
                </div>
              </ScrollArea>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => {
                  // Always go back to Step 1
                  setShowProfileForm(false);
                  setVendor('');
                  setIssue('');
                  setSubIssue('');
                  setStep(1);
                }}>
                  Back
                </Button>
                <Button 
                  onClick={() => {
                    // Save profile if user opted to
                    if (saveAsProfile && profileName.trim() && !selectedProfileId) {
                      addProfile({
                        name: profileName.trim(),
                        fullName: govFullName,
                        dateOfBirth: govDateOfBirth,
                        state: govState,
                        zipCode: govZipCode,
                      });
                    }
                    setStep(4);
                  }} 
                  disabled={!isGovInfoValid || !showProfileForm}
                  variant="primary"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}
          
          {/* Step 3 for non-Government OR Step 4 for Government - Review & Confirm */}
          {((step === 3 && vendor !== "Government / Public Services") || (step === 4 && vendor === "Government / Public Services")) && (
            <div>
              <Label className="text-base font-medium">Review & Confirm</Label>
              <p className="text-sm text-muted-foreground mb-4">Check the details before we start</p>
              
              <Card className="bg-muted/50">
                <CardHeader>
                  <CardTitle className="text-lg">{vendor}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <strong>Issue:</strong> {vendor === "Government / Public Services" ? `${issue} - ${subIssue}` : issue}
                  </div>
                  {vendor === "Government / Public Services" && (
                    <>
                      <div>
                        <strong>Name:</strong> {govFullName}
                      </div>
                      <div>
                        <strong>Date of Birth:</strong> {govDateOfBirth}
                      </div>
                      <div>
                        <strong>State:</strong> {govState}
                      </div>
                      <div>
                        <strong>ZIP Code:</strong> {govZipCode}
                      </div>
                      {govLicenseNumber && (
                        <div>
                          <strong>License #:</strong> {govLicenseNumber}
                        </div>
                      )}
                      {govLicenseIssueType && (
                        <div>
                          <strong>Issue Type:</strong> {govLicenseIssueType}
                        </div>
                      )}
                      {govCallGoal && (
                        <div>
                          <strong>Goal:</strong> {govCallGoal}
                        </div>
                      )}
                    </>
                  )}
                  {vendor !== "Government / Public Services" && (
                    <>
                      {orderNumber && (
                        <div>
                          <strong>Order:</strong> #{orderNumber}
                        </div>
                      )}
                      <div>
                        <strong>Goal:</strong> {outcome}
                      </div>
                    </>
                  )}
                  <div className="text-sm text-muted-foreground pt-2 border-t">
                    We'll identify as your authorized assistant and work to achieve this outcome. 
                    You may receive notifications if we need your input for verification.
                  </div>
                </CardContent>
              </Card>
              
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(vendor === "Government / Public Services" ? 3 : 2)}>
                  Back
                </Button>
                <Button variant="success" onClick={() => { void handleCreateTask(); }} disabled={isCreatingTask}>
                  Start Task
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}