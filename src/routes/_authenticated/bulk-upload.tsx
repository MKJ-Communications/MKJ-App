import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Upload, FileSpreadsheet, Download, Info } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Route = createFileRoute("/_authenticated/bulk-upload")({
  head: () => ({
    meta: [
      { title: "Bulk Upload — MKJ Ops" },
      { name: "description", content: "Admin-only bulk data import via Excel spreadsheets." },
      { property: "og:title", content: "Bulk Upload — MKJ Ops" },
      { property: "og:description", content: "Admin-only bulk data import via Excel spreadsheets." },
    ],
  }),
  component: BulkUploadPage,
});

function BulkUploadPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function downloadTemplate() {
    const link = document.createElement("a");
    link.href = "/bulk-upload-template.xlsx";
    link.download = "mkj-ops-bulk-upload-template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Bulk Upload"
        description="Admin-only tool for importing data via Excel spreadsheets."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Bulk File
          </CardTitle>
          <CardDescription>
            Select an Excel spreadsheet to begin a bulk import. File processing,
            validation, and persistence will be implemented in a future update.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Button onClick={openFilePicker}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Bulk File
            </Button>

            {selectedFile ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{selectedFile.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                No file selected
              </div>
            )}
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Use the template</AlertTitle>
            <AlertDescription>
              Download the template above and fill the numbered tabs in order — later tabs refer to
              earlier ones by Job # and part number. Its Instructions tab covers the rules that
              matter, including why opening inventory can only be imported once. Selecting a file
              here doesn't validate or import anything yet.
            </AlertDescription>
          </Alert>

          <div className="rounded-md border p-4">
            <h3 className="mb-3 text-sm font-semibold">Future capabilities</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Validate columns and row data before importing
              </li>
              <li className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Track upload progress and import history
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
