
# Plan: Update Service Category Selection in New Task Dialog

## Overview
Modify the "Create Support Task" dialog (Step 1) to replace the current vendor cards with a list of service categories that users can scroll through and select.

## Changes Required

### 1. Update Text Labels
- Change "Choose Vendor" to "Choose Service"
- Change "Select the company you need help with" to "Select the service you need help with"
- Update the search placeholder from "Search for a vendor..." to "Search for a service..."

### 2. Replace Vendor Categories with Service Categories
Replace the current 4 vendor cards (Whole Foods, Amazon, Spectrum, Chase Bank) with the following 10 service categories:

| Category | Icon | Color |
|----------|------|-------|
| Medical | Stethoscope | Red |
| Utility | Zap | Yellow |
| Insurance | Shield | Green |
| Banking / Finance | CreditCard | Blue |
| Retail / Commerce | ShoppingBag | Orange |
| Housing / Real Estate | Home | Teal |
| Education | GraduationCap | Purple |
| Transportation / Travel | Plane | Sky Blue |
| Government / Public Services | Building2 | Gray |
| Others | MoreHorizontal | Slate |

### 3. Make the List Scrollable
- Keep the existing dialog size (`max-w-2xl max-h-[80vh]`)
- Wrap the service category grid in a `ScrollArea` component with a fixed height (approximately 300px)
- This allows users to scroll through all 10 categories without changing the dialog dimensions

### 4. Update Issue Types Mapping
Update the `issueTypes` object to map to the new service categories with appropriate issue options for each.

---

## Technical Details

### File to Modify
`src/components/NewTaskDialog.tsx`

### Key Changes

**1. Update imports** - Add new icons from lucide-react:
- Stethoscope, Zap, Shield, Home, GraduationCap, Plane, Building2, MoreHorizontal
- Import ScrollArea from UI components

**2. Replace `popularVendors` array** with `serviceCategories`:
```text
serviceCategories = [
  { name: "Medical", icon: Stethoscope, color: "bg-red-500" },
  { name: "Utility", icon: Zap, color: "bg-yellow-500" },
  { name: "Insurance", icon: Shield, color: "bg-green-500" },
  { name: "Banking / Finance", icon: CreditCard, color: "bg-blue-500" },
  { name: "Retail / Commerce", icon: ShoppingBag, color: "bg-orange-500" },
  { name: "Housing / Real Estate", icon: Home, color: "bg-teal-500" },
  { name: "Education", icon: GraduationCap, color: "bg-purple-500" },
  { name: "Transportation / Travel", icon: Plane, color: "bg-sky-500" },
  { name: "Government / Public Services", icon: Building2, color: "bg-gray-500" },
  { name: "Others", icon: MoreHorizontal, color: "bg-slate-500" }
]
```

**3. Update `issueTypes` object** with category-specific issues for each service type.

**4. Wrap grid in ScrollArea**:
```text
<ScrollArea className="h-[300px]">
  <div className="grid grid-cols-2 gap-3 pr-3">
    {/* service category cards */}
  </div>
</ScrollArea>
```

**5. Update text labels** on lines 101-102 and search placeholder on line 108.

---

## Visual Result
- The dialog will maintain its current size
- Users will see the same 2-column grid layout
- A scrollable area will display all 10 service categories
- The scrollbar appears on the right side of the category list
- All other functionality (search, selection, continue button) remains the same
