import React, { useState, useEffect } from 'react';
import { ClipboardList, Plus, Package, CheckCircle2, Truck, Calendar, Search, Building2, User, Trash2, Printer, FileSpreadsheet, DownloadCloud, Pencil, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmModal from '../components/ConfirmModal';
import PromptModal from '../components/PromptModal';
import ExportModal from '../components/ExportModal';
import { inventoryService } from '../services/inventoryService';
import { userService } from '../services/userService';
import { Item, Request as RequestType, User as AppUser } from '../types';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, collection, query, orderBy, onSnapshot, Timestamp } from '../lib/omniServer';
import { exportToExcel, printTable } from '../lib/exportUtils';

const ITEMS_PER_PAGE = 10;

interface RequestTransaction {
  id: string;
  dateRequested: string;
  requestedBy: string;
  unitDepartment: string;
  items: RequestType[];
  status: 'Pending' | 'Approved' | 'Released';
  receivedBy?: string;
  releasedAt?: Timestamp;
}

const Requests: React.FC = () => {
  const [requests, setRequests] = useState<RequestType[]>([]);
  const [transactions, setTransactions] = useState<RequestTransaction[]>([]);
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<RequestType | null>(null);
  const [exportModal, setExportModal] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<AppUser | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [releaseState, setReleaseState] = useState<{ isOpen: boolean; transaction: RequestTransaction | null }>({
    isOpen: false,
    transaction: null
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; id: string }>({
    isOpen: false,
    id: ''
  });

  // New Request State
  const [requestDetails, setRequestDetails] = useState({
    dateRequested: format(new Date(), 'yyyy-MM-dd'),
    unitDepartment: '',
    requestedBy: ''
  });
  const [requestedBySuggestions, setRequestedBySuggestions] = useState<string[]>([]);
  const [unitDepartmentSuggestions, setUnitDepartmentSuggestions] = useState<string[]>([]);
  
  const [requestItems, setRequestItems] = useState([
    { itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }
  ]);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);

  useEffect(() => {
    let unsubscribeRequests: () => void;
    let unsubscribeItems: () => void;

    const setupListeners = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          const profile = await userService.getUser(auth.currentUser.uid, auth.currentUser.email || undefined);
          setCurrentUserProfile(profile || null);
        }

        const requestsQuery = query(collection(db, 'requests'), orderBy('dateRequested', 'desc'));
        unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
          const reqs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RequestType));
          setRequests(reqs);
          
          // Group by transaction (date, requester, department)
          const groups: { [key: string]: RequestTransaction } = {};
          reqs.forEach(req => {
            const key = `${req.dateRequested}_${req.requestedBy}_${req.unitDepartment}`;
            if (!groups[key]) {
              groups[key] = {
                id: key,
                dateRequested: req.dateRequested,
                requestedBy: req.requestedBy,
                unitDepartment: req.unitDepartment,
                items: [],
                status: req.status, // Initially take the status of the first item
              };
            }
            groups[key].items.push(req);
            
            // If any item is pending, the group is pending
            // If all are released, group is released
            // (Simple logic: if any is Pending, group is Pending; else if any Approved, Approved; else Released)
            if (req.status === 'Pending') groups[key].status = 'Pending';
            else if (req.status === 'Approved' && groups[key].status !== 'Pending') groups[key].status = 'Approved';

            // Store metadata from the group
            if (req.receivedBy) groups[key].receivedBy = req.receivedBy;
            if (req.releasedAt) groups[key].releasedAt = req.releasedAt;
          });

          setTransactions(Object.values(groups));
          
          // Extract unique requestedBy names
          const uniqueNames = Array.from(new Set(
            reqs.filter(r => r.requestedBy).map(r => r.requestedBy!)
          )) as string[];
          setRequestedBySuggestions(uniqueNames);
          
          // Extract unique unitDepartment names
          const uniqueDepts = Array.from(new Set(
            reqs.filter(r => r.unitDepartment).map(r => r.unitDepartment!)
          )) as string[];
          setUnitDepartmentSuggestions(uniqueDepts);
        }, (error) => {
          console.error("Requests listener failed:", error);
        });

        const itemsQuery = query(collection(db, 'items'), orderBy('itemId', 'asc'));
        unsubscribeItems = onSnapshot(itemsQuery, (snapshot) => {
          setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
          setLoading(false);
        }, (error) => {
          console.error("Items listener failed:", error);
          setLoading(false);
        });
      } catch (err) {
        console.error("Setup listeners failed:", err);
        setLoading(false);
      }
    };

    setupListeners();
    return () => {
      unsubscribeRequests?.();
      unsubscribeItems?.();
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const handleSelectItem = (index: number, itemId: string) => {
    const item = items.find(i => i.itemId === itemId);
    const newItems = [...requestItems];
    if (item) {
      newItems[index] = {
        ...newItems[index],
        itemId: item.itemId,
        category: item.category,
        description: item.description,
        uom: item.uom,
        qtyPerUom: item.qtyPerUom || ''
      };
    } else {
      newItems[index] = { ...newItems[index], itemId };
    }
    setRequestItems(newItems);
  };

  const handleEdit = (req: RequestType) => {
    setEditingRequest(req);
    setRequestDetails({
      dateRequested: req.dateRequested,
      unitDepartment: req.unitDepartment,
      requestedBy: req.requestedBy
    });
    setRequestItems([{
      itemId: req.itemId,
      category: req.category,
      description: req.description,
      uom: req.uom,
      qty: req.qty,
      qtyPerUom: (items.find(i => i.itemId === req.itemId)?.qtyPerUom) || ''
    }]);
    setSearchTerms([`${req.itemId} - ${req.description}`]);
    setShowModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    const validItems = requestItems.filter(ri => ri.itemId && ri.qty > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one valid item with quantity > 0');
      return;
    }

    try {
      if (editingRequest) {
        // Only update the first valid item as edit is for single record
        const ri = validItems[0];
        await inventoryService.updateRequest(editingRequest.id, {
          ...ri,
          ...requestDetails
        });
        toast.success('Request updated successfully');
      } else {
        await Promise.all(validItems.map(ri => 
          inventoryService.createRequest({
            ...ri,
            ...requestDetails
          })
        ));
        toast.success('Request submitted successfully');
      }
      setShowModal(false);
      setEditingRequest(null);
      setRequestDetails({
        dateRequested: format(new Date(), 'yyyy-MM-dd'), unitDepartment: '',
        requestedBy: ''
      });
      setRequestItems([{ itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
    } catch (err: any) {
      console.error('Failed to create request:', err);
      let message = 'Failed to create request';
      try {
        const errorDetail = JSON.parse(err.message);
        message = `Error: ${errorDetail.error}`;
      } catch {
        message = err.message || 'Failed to create request';
      }
      toast.error(message);
    }
  };

  const handleReleaseTransaction = async (tx: RequestTransaction, receiverName: string) => {
    if (!receiverName.trim()) {
      toast.warning('Receiver name is required');
      return;
    }
    
    try {
      setLoading(true);
      const pendingItems = tx.items.filter(item => item.status === 'Pending');
      
      await Promise.all(pendingItems.map(item => 
        inventoryService.releaseRequest(item.id, item.itemId, item.qty, receiverName.trim())
      ));
      
      toast.success(`Successfully released ${pendingItems.length} items to ${receiverName}`);
    } catch (err: any) {
      console.error('Transaction release failed:', err);
      toast.error('Failed to release some items. Please check inventory stock.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (requestId: string) => {
    try {
      await inventoryService.deleteRequest(requestId);
      toast.success('Request deleted successfully');
    } catch (err: any) {
      console.error('Delete failed:', err);
      let message = 'Failed to delete request';
      try {
        const errorDetail = JSON.parse(err.message);
        message = `Permission Error: ${errorDetail.error}. Status: ${errorDetail.operationType}`;
      } catch {
        message = err.message || 'Failed to delete request';
      }
      toast.error(message);
    }
  };

  const hasEditPermission = currentUserProfile?.role === 'System Admin' ||
                            auth.currentUser?.email === 'tanglaorichmond.cswd@gmail.com' ||
                            auth.currentUser?.email === 'tanglaorichmond@gmail.com' ||
                            currentUserProfile?.canEdit === true ||
                            (currentUserProfile?.canEdit === undefined && currentUserProfile?.role === 'Admin');

  const hasDeletePermission = currentUserProfile?.role === 'System Admin' ||
                              auth.currentUser?.email === 'tanglaorichmond.cswd@gmail.com' ||
                              auth.currentUser?.email === 'tanglaorichmond@gmail.com' ||
                              currentUserProfile?.canDelete === true ||
                              (currentUserProfile?.canDelete === undefined && currentUserProfile?.role === 'Admin');

  const handleExportExcel = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const dataForExport = requests
      .filter(req => {
        const date = new Date(req.dateRequested);
        return date >= start && date <= end;
      })
      .map(req => ({
        'Status': req.status,
        'Date Requested': format(new Date(req.dateRequested), 'yyyy-MM-dd'),
        'Description': req.description,
        'Item ID': req.itemId,
        'Quantity': req.qty,
        'Requested By': req.requestedBy,
        'Received By': req.receivedBy || '',
        'Department': req.unitDepartment
      }));
    exportToExcel(dataForExport, `Requests_${startDate}_to_${endDate}`);
    setExportModal(false);
  };

  const handlePrint = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const columns = ['Status', 'Date', 'Description', 'Item', 'Qty', 'Requested By', 'Received By', 'Department'];
    const data = requests
      .filter(req => {
        const date = new Date(req.dateRequested);
        return date >= start && date <= end;
      })
      .map(req => [
        req.status,
        format(new Date(req.dateRequested), 'MMM dd, yyyy'),
        req.description,
        req.itemId,
        req.qty,
        req.requestedBy,
        req.receivedBy || '-',
        req.unitDepartment
      ]);
    printTable(`Requests Report (${startDate} to ${endDate})`, columns, data);
    setExportModal(false);
  };

  const filteredTransactions = transactions.filter(tx => {
    const searchLower = searchTerm.toLowerCase();
    const matchesRequester = tx.requestedBy.toLowerCase().includes(searchLower);
    const matchesDept = tx.unitDepartment.toLowerCase().includes(searchLower);
    const matchesItems = tx.items.some(item => 
      item.description.toLowerCase().includes(searchLower) || 
      item.itemId.toLowerCase().includes(searchLower)
    );
    return matchesRequester || matchesDept || matchesItems;
  });

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedTransactions);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedTransactions(newExpanded);
  };

  return (
    <div className="space-y-8 font-sans">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/40">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-slate-900 uppercase">
            Item <span className="text-brand-accent">Requests</span>
          </h1>
          <p className="mt-1 text-[10px] sm:text-sm font-medium text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <ClipboardList size={14} className="text-brand-accent" />
            Manage and fulfill department item requests.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group/search">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within/search:text-brand-accent transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search requests..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 py-3 text-sm font-bold text-slate-900 placeholder:text-slate-300 focus:border-brand-accent/30 focus:outline-none focus:ring-4 focus:ring-brand-accent/5 transition-all shadow-sm"
            />
          </div>
          <button
            onClick={() => setExportModal(true)}
            className="group flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-95"
            title="Export to Excel or Print"
          >
            <DownloadCloud size={18} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="group flex items-center gap-2 rounded-2xl bg-brand-primary px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-800 hover:-translate-y-0.5 active:scale-95"
          >
            <Plus size={18} className="transition-transform group-hover:rotate-90" />
            New Request
          </button>
        </div>
      </div>

      <div className="rounded-[2.5rem] border border-slate-100 bg-white shadow-2xl shadow-slate-200/50 overflow-hidden">
        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-accent border-t-transparent shadow-lg shadow-blue-100" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-5 w-10 text-center"></th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5">Date Requested</th>
                  <th className="px-8 py-5">Total Items</th>
                  <th className="px-8 py-5">Requested By</th>
                  <th className="px-8 py-5">Department</th>
                  <th className="px-8 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 italic-serif-headers text-slate-600 font-medium">
                {paginatedTransactions.map((tx) => (
                  <React.Fragment key={tx.id}>
                    <tr 
                      className={`group hover:bg-slate-50/80 transition-all cursor-pointer ${(searchTerm ? true : expandedTransactions.has(tx.id)) ? 'bg-slate-50' : ''}`}
                      onClick={() => toggleExpand(tx.id)}
                    >
                      <td className="px-6 py-5 text-center">
                        <button className="text-slate-400">
                          {(searchTerm ? true : expandedTransactions.has(tx.id)) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td className="px-8 py-5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] border ${
                          tx.status === 'Released' 
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100 shadow-sm' 
                            : tx.status === 'Approved' 
                            ? 'bg-blue-50 text-blue-700 border-blue-100 shadow-sm' 
                            : 'bg-amber-50 text-amber-700 border-amber-100 shadow-sm'
                        }`}>
                          {tx.status === 'Released' && <CheckCircle2 size={12} />}
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-8 py-5 whitespace-nowrap font-mono text-xs text-slate-400">
                        {format(new Date(tx.dateRequested), 'MMM dd, yyyy')}
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-display font-black text-slate-900 text-lg">
                          {tx.items.length}
                        </span>
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-400 font-bold">Items</span>
                      </td>
                      <td className="px-8 py-5 font-bold uppercase text-[11px] tracking-tight">{tx.requestedBy}</td>
                      <td className="px-8 py-5">
                        <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 font-extrabold text-[10px] uppercase tracking-widest border border-slate-200">
                          {tx.unitDepartment}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                          {hasEditPermission && tx.status !== 'Released' && (
                            <button
                              onClick={() => setReleaseState({ isOpen: true, transaction: tx })}
                              className="rounded-xl bg-brand-primary px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-slate-800 shadow-lg shadow-slate-200"
                            >
                              Fulfill Transaction
                            </button>
                          )}
                          {tx.status === 'Released' && (
                            <span className="text-[10px] text-slate-300 uppercase font-mono font-bold tracking-tighter">
                              {tx.releasedAt?.toDate ? format(tx.releasedAt.toDate(), 'MM/dd HH:mm') : ''}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    
                    {/* Expanded Content */}
                    <AnimatePresence>
                      {(searchTerm ? true : expandedTransactions.has(tx.id)) && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-slate-50/30"
                        >
                          <td colSpan={7} className="px-8 py-0">
                            <div className="pb-8 pt-2 pl-12 border-l-4 border-brand-accent/20">
                              <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50/50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                                    <tr>
                                      <th className="px-6 py-4">Item Details</th>
                                      <th className="px-6 py-4">Qty</th>
                                      <th className="px-6 py-4">UOM</th>
                                      <th className="px-6 py-4">Recieved By</th>
                                      <th className="px-6 py-4 text-right">Row Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-50">
                                    {tx.items.map((item) => (
                                      <tr key={item.id} className="group/row hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                          <p className="font-display font-bold text-slate-800 uppercase leading-none">{item.description}</p>
                                          <p className="text-[9px] text-brand-accent/60 font-black mt-1 uppercase tracking-tighter">{item.itemId}</p>
                                        </td>
                                        <td className="px-6 py-4 font-mono font-black text-slate-900">{item.qty}</td>
                                        <td className="px-6 py-4 text-slate-500 font-bold uppercase">{item.uom}</td>
                                        <td className="px-6 py-4 text-slate-400 font-bold uppercase text-[9px] italic tracking-widest">
                                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[8px] font-bold border ${item.status === 'Released' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                            {item.status === 'Released' ? (item.receivedBy || 'Released') : 'Pending'}
                                          </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                          <div className="flex justify-end items-center gap-1">
                                            {(hasEditPermission || hasDeletePermission) && (
                                              <>
                                                {hasEditPermission && item.status === 'Pending' && (
                                                  <button 
                                                    onClick={() => setReleaseState({ 
                                                      isOpen: true, 
                                                      transaction: { ...tx, items: [item] } 
                                                    })}
                                                    className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all"
                                                    title="Release This Item"
                                                  >
                                                    <Truck size={14} />
                                                  </button>
                                                )}
                                                {hasEditPermission && (
                                                  <button 
                                                    onClick={() => handleEdit(item)}
                                                    className="p-1.5 text-brand-accent hover:bg-brand-accent/5 rounded-lg transition-all"
                                                    title="Edit"
                                                  >
                                                    <Pencil size={14} />
                                                  </button>
                                                )}
                                                {hasDeletePermission && (
                                                  <button 
                                                    onClick={() => setDeleteConfirm({ isOpen: true, id: item.id })}
                                                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                    title="Delete"
                                                  >
                                                    <Trash2 size={14} />
                                                  </button>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-8 py-24 text-center text-slate-300 font-medium italic">
                      No inventory requests found.
                    </td>
                  </tr>
                ) : paginatedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-8 py-24 text-center text-slate-300 font-medium italic">
                      No matching requests found for your search.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            
            {/* Pagination Controls */}
            {filteredTransactions.length > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-between px-8 py-4 bg-slate-50/50 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 border border-slate-200 rounded-lg px-2 py-1 uppercase tracking-widest bg-white">
                  Page <span className="text-brand-accent">{currentPage}</span> of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className={`p-2 rounded-xl border transition-all ${
                      currentPage === 1 
                        ? 'border-slate-100 text-slate-200 cursor-not-allowed' 
                        : 'border-slate-200 text-slate-600 hover:bg-white hover:border-brand-accent hover:text-brand-accent shadow-sm'
                    }`}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                      .map((p, i, arr) => (
                        <React.Fragment key={p}>
                          {i > 0 && arr[i-1] !== p - 1 && (
                            <span className="px-2 py-2 text-slate-300">...</span>
                          )}
                          <button
                            onClick={() => setCurrentPage(p)}
                            className={`min-w-[32px] h-8 rounded-xl text-[10px] font-black transition-all ${
                              currentPage === p
                                ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/20'
                                : 'text-slate-400 hover:bg-white hover:text-brand-accent border border-transparent hover:border-slate-200'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      ))}
                  </div>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className={`p-2 rounded-xl border transition-all ${
                      currentPage === totalPages 
                        ? 'border-slate-100 text-slate-200 cursor-not-allowed' 
                        : 'border-slate-200 text-slate-600 hover:bg-white hover:border-brand-accent hover:text-brand-accent shadow-sm'
                    }`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Request Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="relative w-full max-w-xl rounded-[2.5rem] bg-white p-10 shadow-2xl shadow-slate-900/20"
            >
              <div className="mb-8">
                <h3 className="text-2xl font-display font-extrabold text-slate-900 uppercase tracking-tight">
                  {editingRequest ? 'Edit' : 'New'} <span className="text-brand-accent">Request</span>
                </h3>
                <p className="text-sm font-medium text-slate-400 mt-1 uppercase tracking-widest">
                  {editingRequest ? 'Update request details.' : 'Fill out the form to request items from inventory.'}
                </p>
              </div>

              <form onSubmit={handleCreate} className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Requested Items</label>
                  </div>
                  <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                        <tr>
                          <th className="px-3 py-3 w-[45%]">Item Selection</th>
                          <th className="px-3 py-3 w-[15%]">UOM</th>
                          <th className="px-3 py-3 w-[15%]">Qty Per UOM</th>
                          <th className="px-3 py-3 w-[15%]">Qty</th>
                          {!editingRequest && <th className="px-2 py-3 w-[10%] text-center"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {requestItems.map((ri, index) => (
                          <tr key={index} className="bg-white group">
                            <td className="p-2">
                              <div className="relative">
                                <input
                                  type="text"
                                  list={`items-${index}`}
                                  placeholder="Search/Select Item..."
                                  className="w-full rounded-xl border border-transparent bg-slate-50/50 px-3 py-2.5 text-xs font-bold text-slate-800 focus:bg-white focus:border-brand-accent/30 focus:ring-2 focus:ring-brand-accent/10 outline-none transition-all"
                                  value={searchTerms[index] || ''}
                                  onChange={(e) => {
                                    const newSearchTerms = [...searchTerms];
                                    newSearchTerms[index] = e.target.value;
                                    setSearchTerms(newSearchTerms);
                                    
                                    const selectedItem = items.find(i => `${i.itemId} - ${i.description} (${i.uom}${i.qtyPerUom ? ' / ' + i.qtyPerUom : ''})` === e.target.value);
                                    if (selectedItem) {
                                      handleSelectItem(index, selectedItem.itemId);
                                    } else {
                                      const newItems = [...requestItems];
                                      newItems[index].itemId = '';
                                      newItems[index].uom = '';
                                      setRequestItems(newItems);
                                    }
                                  }}
                                />
                                <datalist id={`items-${index}`}>
                                  {items.map(item => (
                                    <option key={item.id} value={`${item.itemId} - ${item.description} (${item.uom}${item.qtyPerUom ? ' / ' + item.qtyPerUom : ''})`} />
                                  ))}
                                </datalist>
                              </div>
                              {ri.itemId && (
                                <div className="px-2 pt-1.5 text-[8.5px] font-black text-brand-accent/60 tracking-widest uppercase">
                                  {ri.category}
                                </div>
                              )}
                            </td>
                            <td className="p-2 align-top">
                              <div className="w-full rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                                {ri.uom || '-'}
                              </div>
                            </td>
                            <td className="p-2 align-top">
                              <div className="w-full rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                                {ri.qtyPerUom || '-'}
                              </div>
                            </td>
                            <td className="p-2 align-top">
                              <input
                                type="number"
                                required
                                min={1}
                                value={ri.qty || ''}
                                onChange={(e) => {
                                  const newItems = [...requestItems];
                                  newItems[index].qty = parseInt(e.target.value) || 0;
                                  setRequestItems(newItems);
                                }}
                                className="w-full rounded-xl border border-transparent bg-slate-50/50 px-3 py-2.5 text-xs font-black text-slate-800 focus:bg-white focus:border-brand-accent/30 focus:ring-2 focus:ring-brand-accent/10 outline-none transition-all uppercase"
                                placeholder="0"
                              />
                            </td>
                            {!editingRequest && (
                              <td className="p-2 align-top text-center pt-3">
                                <button 
                                  type="button" 
                                  onClick={() => setRequestItems(requestItems.filter((_, i) => i !== index))}
                                  className={`p-1.5 rounded-lg transition-colors ${requestItems.length > 1 ? 'text-rose-400 hover:bg-rose-50 hover:text-rose-600' : 'text-slate-200 cursor-not-allowed'}`}
                                  disabled={requestItems.length <= 1}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!editingRequest && (
                    <button
                      type="button"
                      onClick={() => {
                        setRequestItems([...requestItems, { itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
                        setSearchTerms([...searchTerms, '']);
                      }}
                      className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:bg-slate-50 hover:border-slate-300 hover:text-slate-600 transition-colors flex items-center justify-center gap-2 mt-4"
                    >
                      <Plus size={14} /> Add Another Item
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Unit/Department</label>
                    <input
                      required
                      list="unitDepartmentSuggestions"
                      value={requestDetails.unitDepartment}
                      onChange={(e) => setRequestDetails({ ...requestDetails, unitDepartment: e.target.value })}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner uppercase"
                      placeholder="e.g. OPERATIONS"
                    />
                    <datalist id="unitDepartmentSuggestions">
                      {unitDepartmentSuggestions.map(dept => (
                        <option key={dept} value={dept} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Requested By</label>
                    <input
                      required
                      list="requestedBySuggestions"
                      value={requestDetails.requestedBy}
                      onChange={(e) => setRequestDetails({ ...requestDetails, requestedBy: e.target.value })}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner uppercase"
                      placeholder="Enter verification name"
                    />
                    <datalist id="requestedBySuggestions">
                      {requestedBySuggestions.map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Date</label>
                  <input
                    type="date"
                    required
                    value={requestDetails.dateRequested}
                    onChange={(e) => setRequestDetails({ ...requestDetails, dateRequested: e.target.value })}
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner uppercase"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t border-slate-50">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setEditingRequest(null);
                      setRequestDetails({
                        dateRequested: format(new Date(), 'yyyy-MM-dd'), unitDepartment: '',
                        requestedBy: ''
                      });
                      setRequestItems([{ itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
                    }}
                    className="rounded-2xl px-6 py-4 text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-2xl bg-brand-primary px-10 py-4 text-xs font-extrabold uppercase tracking-[0.2em] text-white shadow-xl shadow-slate-200 hover:bg-slate-800 hover:-translate-y-0.5 transition-all"
                  >
                    {editingRequest ? 'Update Request' : 'Save Request'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        title="Delete Request"
        message="Are you sure you want to delete this request record? This action cannot be undone."
        confirmLabel="Delete Request"
        variant="danger"
        onConfirm={() => handleDelete(deleteConfirm.id)}
        onCancel={() => setDeleteConfirm({ isOpen: false, id: '' })}
      />

      <PromptModal
        isOpen={releaseState.isOpen}
        title="Release Items"
        message={`Enter name of the person receiving ${
          releaseState.transaction?.items.length === 1 
            ? releaseState.transaction.items[0].description 
            : 'all items in this transaction'
        }:`}
        initialValue={releaseState.transaction?.requestedBy}
        confirmLabel="Confirm Release"
        onConfirm={(val) => {
          if (releaseState.transaction) handleReleaseTransaction(releaseState.transaction, val);
          setReleaseState({ isOpen: false, transaction: null });
        }}
        onCancel={() => setReleaseState({ isOpen: false, transaction: null })}
      />

      <ExportModal
        isOpen={exportModal}
        onClose={() => setExportModal(false)}
        onExportExcel={handleExportExcel}
        onPrint={handlePrint}
        title="Export Requests"
      />
    </div>
  );
};

export default Requests;
