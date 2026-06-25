import React, { useState, useEffect } from 'react';
import { Truck, Plus, Package, Calendar, User, Search, Download, Trash2, Printer, FileSpreadsheet, DownloadCloud, Pencil, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmModal from '../components/ConfirmModal';
import ExportModal from '../components/ExportModal';
import { inventoryService } from '../services/inventoryService';
import { userService } from '../services/userService';
import { Delivery, Item, User as AppUser } from '../types';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from '../lib/omniServer';
import { exportToExcel, printTable } from '../lib/exportUtils';

const ITEMS_PER_PAGE = 10;

interface DeliveryTransaction {
  id: string;
  dateDelivered: string;
  orNumber: string;
  receivedBy: string;
  items: Delivery[];
}

const Deliveries: React.FC = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [transactions, setTransactions] = useState<DeliveryTransaction[]>([]);
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [exportModal, setExportModal] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<AppUser | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; delivery: Delivery | null }>({
    isOpen: false,
    delivery: null
  });
  
  // New Delivery State
  const [deliveryDetails, setDeliveryDetails] = useState({
    dateDelivered: format(new Date(), 'yyyy-MM-dd'),
    orNumber: '',
    receivedBy: ''
  });
  const [receivedBySuggestions, setReceivedBySuggestions] = useState<string[]>([]);
  
  const [deliveryItems, setDeliveryItems] = useState([
    { itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }
  ]);
  const [searchTerms, setSearchTerms] = useState<string[]>(['']);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dels, its] = await Promise.all([
        inventoryService.getDeliveries(),
        inventoryService.getItems()
      ]);
      
      if (auth.currentUser) {
        const profile = await userService.getUser(auth.currentUser.uid, auth.currentUser.email || undefined);
        setCurrentUserProfile(profile || null);
      }

      const deliveryList = dels || [];
      setDeliveries(deliveryList);
      setItems(its || []);
      
      // Group by transaction (date, orNumber, receivedBy)
      const groups: { [key: string]: DeliveryTransaction } = {};
      deliveryList.forEach(del => {
        const key = `${del.dateDelivered}_${del.orNumber || 'NO_OR'}_${del.receivedBy}`;
        if (!groups[key]) {
          groups[key] = {
            id: key,
            dateDelivered: del.dateDelivered,
            orNumber: del.orNumber || '',
            receivedBy: del.receivedBy,
            items: []
          };
        }
        groups[key].items.push(del);
      });
      setTransactions(Object.values(groups));
      
      // Extract unique receivedBy names
      const uniqueNames = Array.from(new Set(
        deliveryList.filter(d => d.receivedBy).map(d => d.receivedBy)
      )) as string[];
      setReceivedBySuggestions(uniqueNames);
      
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
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

  const handleSelectItem = (index: number, itemId: string) => {
    const item = items.find(i => i.itemId === itemId);
    const newItems = [...deliveryItems];
    if (item) {
      newItems[index] = {
        ...newItems[index],
        itemId: item.itemId,
        category: item.category,
        description: item.description,
        uom: item.uom,
        qtyPerUom: item.qtyPerUom || ''
      };
      const newSearchTerms = [...searchTerms];
      newSearchTerms[index] = `${item.itemId} - ${item.description}`;
      setSearchTerms(newSearchTerms);
    } else {
      newItems[index] = { ...newItems[index], itemId };
    }
    setDeliveryItems(newItems);
  };

  const handleEdit = (del: Delivery) => {
    setEditingDelivery(del);
    setDeliveryDetails({
      dateDelivered: del.dateDelivered,
      orNumber: del.orNumber,
      receivedBy: del.receivedBy
    });
    setDeliveryItems([{
      itemId: del.itemId,
      category: del.category,
      description: del.description,
      uom: del.uom,
      qty: del.qty,
      qtyPerUom: (items.find(i => i.itemId === del.itemId)?.qtyPerUom) || ''
    }]);
    setSearchTerms([`${del.itemId} - ${del.description}`]);
    setShowModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    // Filter out rows without itemId or zero/negative qty
    const validItems = deliveryItems.filter(di => di.itemId && di.qty > 0);
    if (validItems.length === 0) {
      toast.error('Please add at least one valid item with quantity > 0');
      return;
    }
    
    try {
      if (editingDelivery) {
        // Only update the first valid item as edit is for single record
        const di = validItems[0];
        await inventoryService.updateDelivery(editingDelivery.id, {
          ...di,
          ...deliveryDetails
        });
        toast.success('Delivery record updated');
      } else {
        await Promise.all(validItems.map(di => 
          inventoryService.addDelivery({
            ...di,
            ...deliveryDetails
          })
        ));
        toast.success('Delivery recorded successfully');
      }
      setShowModal(false);
      setEditingDelivery(null);
      loadData();
      setDeliveryDetails({
        dateDelivered: format(new Date(), 'yyyy-MM-dd'), orNumber: '', receivedBy: ''
      });
      setDeliveryItems([{ itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
    } catch (err: any) {
      console.error('Failed to add delivery:', err);
      let message = 'Failed to save delivery';
      try {
        const errorDetail = JSON.parse(err.message);
        message = `Error: ${errorDetail.error}`;
      } catch {
        message = err.message || 'Failed to save delivery';
      }
      toast.error(message);
    }
  };

  const handleDelete = async (del: Delivery) => {
    try {
      await inventoryService.deleteDelivery(del.id, del.itemId, del.qty);
      toast.success('Delivery record deleted');
      loadData();
    } catch (err) {
      toast.error('Failed to delete delivery');
    }
  };

  const handleExportExcel = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const dataForExport = deliveries
      .filter(del => {
        const date = new Date(del.dateDelivered);
        return date >= start && date <= end;
      })
      .map(del => ({
        'Date Delivered': format(new Date(del.dateDelivered), 'yyyy-MM-dd'),
        'Item ID': del.itemId,
        'Description': del.description,
        'Category': del.category,
        'UOM': del.uom,
        'Quantity': del.qty,
        'OR Number': del.orNumber || '',
        'Received By': del.receivedBy || ''
      }));
    exportToExcel(dataForExport, `Deliveries_${startDate}_to_${endDate}`);
    setExportModal(false);
  };

  const handlePrint = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const columns = ['Date', 'Item ID', 'Description', 'Category', 'Qty', 'OR Number', 'Received By'];
    const data = deliveries
      .filter(del => {
        const date = new Date(del.dateDelivered);
        return date >= start && date <= end;
      })
      .map(del => [
        format(new Date(del.dateDelivered), 'MMM dd, yyyy'),
        del.itemId,
        del.description,
        del.category,
        del.qty,
        del.orNumber || '-',
        del.receivedBy || '-'
      ]);
    printTable(`Deliveries Report (${startDate} to ${endDate})`, columns, data);
    setExportModal(false);
  };

  const filteredTransactions = transactions.filter(tx => {
    const searchLower = searchTerm.toLowerCase();
    const matchesReceiver = tx.receivedBy.toLowerCase().includes(searchLower);
    const matchesOR = tx.orNumber.toLowerCase().includes(searchLower);
    const matchesItems = tx.items.some(item => 
      item.description.toLowerCase().includes(searchLower) || 
      item.itemId.toLowerCase().includes(searchLower)
    );
    return matchesReceiver || matchesOR || matchesItems;
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
            Delivery <span className="text-brand-accent">Management</span>
          </h1>
          <p className="mt-1 text-[10px] sm:text-sm font-medium text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Truck size={14} className="text-brand-accent" />
            Track incoming supplies and office stock.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group/search">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within/search:text-brand-accent transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search deliveries..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 py-3 text-sm font-bold text-slate-900 placeholder:text-slate-300 focus:border-brand-accent/30 focus:outline-none focus:ring-4 focus:ring-brand-accent/5 transition-all shadow-sm"
            />
          </div>
          <button
            onClick={() => setExportModal(true)}
            className="group flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-95"
            title="Export to Excel or Print PDF"
          >
            <DownloadCloud size={18} />
            <span className="hidden sm:inline">Export</span>
          </button>
          {hasEditPermission && (
            <button
              onClick={() => setShowModal(true)}
              className="group flex items-center gap-2 rounded-2xl bg-brand-primary px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-slate-200 transition-all hover:bg-slate-800 hover:-translate-y-0.5 active:scale-95"
            >
              <Plus size={18} className="transition-transform group-hover:rotate-90" />
              New Delivery
            </button>
          )}
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
                  <th className="px-8 py-5 text-center">Items</th>
                  <th className="px-8 py-5">Date</th>
                  <th className="px-8 py-5">OR Number</th>
                  <th className="px-8 py-5">Received By</th>
                  <th className="px-8 py-5 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 italic-serif-headers text-slate-600 font-medium">
                {paginatedTransactions.map((tx) => (
                  <React.Fragment key={tx.id}>
                    <tr 
                      className={`group hover:bg-slate-50/80 transition-all cursor-pointer ${(searchTerm ? true : expandedTransactions.has(tx.id)) ? 'bg-slate-50/50' : ''}`}
                      onClick={() => toggleExpand(tx.id)}
                    >
                      <td className="px-6 py-5 text-center">
                        <button className="text-slate-400">
                          {(searchTerm ? true : expandedTransactions.has(tx.id)) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td className="px-8 py-5 text-center">
                        <span className="font-display font-black text-slate-900 text-lg">
                          {tx.items.length}
                        </span>
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-400 font-bold">Line Items</span>
                      </td>
                      <td className="px-8 py-5 whitespace-nowrap text-slate-400 font-mono text-xs">
                        {format(new Date(tx.dateDelivered), 'MMM dd, yyyy')}
                      </td>
                      <td className="px-8 py-5">
                        <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 font-mono font-bold text-[10px] uppercase tracking-widest border border-slate-200">
                          {tx.orNumber || '---'}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-slate-900 font-bold uppercase text-xs tracking-tight">{tx.receivedBy}</td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                           {/* Empty actions for transaction row to avoid confusion, or can add a "Delete All" if requested */}
                        </div>
                      </td>
                    </tr>
                    
                    {/* Expanded Items */}
                    <AnimatePresence>
                      {(searchTerm ? true : expandedTransactions.has(tx.id)) && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-slate-50/30"
                        >
                          <td colSpan={6} className="px-8 py-0">
                            <div className="pb-8 pt-2 pl-12 border-l-4 border-brand-accent/20">
                              <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50/50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                                    <tr>
                                      <th className="px-6 py-4">Item Identification</th>
                                      <th className="px-6 py-4">Quantity</th>
                                      <th className="px-6 py-4">Category</th>
                                      <th className="px-6 py-4">UOM</th>
                                      <th className="px-6 py-4 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-50">
                                    {tx.items.map((del) => (
                                      <tr key={del.id} className="group/row hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                          <p className="font-display font-bold text-slate-800 uppercase leading-none">{del.description}</p>
                                          <p className="text-[9px] text-brand-accent/60 font-black mt-1 uppercase tracking-tighter">{del.itemId}</p>
                                        </td>
                                        <td className="px-6 py-4 font-mono font-black text-slate-900 text-sm">{del.qty}</td>
                                        <td className="px-6 py-4 text-slate-500 font-bold uppercase text-[10px] tracking-widest">{del.category}</td>
                                        <td className="px-6 py-4 text-slate-400 font-extrabold uppercase">{del.uom}</td>
                                        <td className="px-6 py-4 text-right">
                                          {(hasEditPermission || hasDeletePermission) && (
                                            <div className="flex items-center justify-end gap-1">
                                              <button 
                                                onClick={() => handleEdit(del)}
                                                className={hasEditPermission ? "p-1.5 text-brand-accent hover:bg-brand-accent/5 rounded-lg transition-all" : "hidden"}
                                                title="Edit Item"
                                              >
                                                <Pencil size={14} />
                                              </button>
                                              <button 
                                                onClick={() => setDeleteConfirm({ isOpen: true, delivery: del })}
                                                className={hasDeletePermission ? "p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-all" : "hidden"}
                                                title="Delete Record"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </div>
                                          )}
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
                    <td colSpan={6} className="px-8 py-24 text-center text-slate-300 font-medium italic">
                      No delivery records found.
                    </td>
                  </tr>
                ) : paginatedTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-24 text-center text-slate-300 font-medium italic">
                      No matching deliveries found for your search.
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

      {/* New Delivery Modal */}
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
              <div className="mb-0">
                <h3 className="text-2xl font-display font-extrabold text-slate-900 uppercase tracking-tight">
                  {editingDelivery ? 'Edit' : 'New'} <span className="text-brand-accent">Delivery</span>
                </h3>
                <p className="text-sm font-medium text-slate-400 mt-1 uppercase tracking-widest">
                  {editingDelivery ? 'Update delivery details.' : 'Enter incoming stock and delivery details.'}
                </p>
              </div>

              <form onSubmit={handleCreate} className="space-y-6 mt-8">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Delivery Items</label>
                  </div>
                  <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                        <tr>
                          <th className="px-3 py-3 w-[45%]">Item Selection</th>
                          <th className="px-3 py-3 w-[15%]">UOM</th>
                          <th className="px-3 py-3 w-[15%]">Qty Per UOM</th>
                          <th className="px-3 py-3 w-[15%]">Qty</th>
                          {!editingDelivery && <th className="px-2 py-3 w-[10%] text-center"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deliveryItems.map((di, index) => (
                          <tr key={index} className="bg-white group">
                            <td className="p-2">
                              <div className="relative">
                                <input
                                  type="text"
                                  list={`items-${index}`}
                                  placeholder="Search/Select Item..."
                                  className="w-full rounded-xl border border-transparent bg-slate-50/50 px-3 py-2.5 text-xs font-bold text-slate-800 focus:bg-white focus:border-brand-accent/30 focus:ring-2 focus:ring-brand-accent/10 outline-none transition-all"
                                  value={searchTerms[index]}
                                  onChange={(e) => {
                                    const newSearchTerms = [...searchTerms];
                                    newSearchTerms[index] = e.target.value;
                                    setSearchTerms(newSearchTerms);
                                    
                                    const selectedItem = items.find(i => `${i.itemId} - ${i.description} (${i.uom}${i.qtyPerUom ? ' / ' + i.qtyPerUom : ''})` === e.target.value);
                                    if (selectedItem) {
                                      handleSelectItem(index, selectedItem.itemId);
                                    } else {
                                      const newItems = [...deliveryItems];
                                      newItems[index].itemId = '';
                                      newItems[index].uom = '';
                                      setDeliveryItems(newItems);
                                    }
                                  }}
                                />
                                <datalist id={`items-${index}`}>
                                  {items.map(item => (
                                    <option key={item.id} value={`${item.itemId} - ${item.description} (${item.uom}${item.qtyPerUom ? ' / ' + item.qtyPerUom : ''})`} />
                                  ))}
                                </datalist>
                              </div>
                              {di.itemId && (
                                <div className="px-2 pt-1.5 text-[8.5px] font-black text-brand-accent/60 tracking-widest uppercase">
                                  {di.category}
                                </div>
                              )}
                            </td>
                            <td className="p-2 align-top">
                              <div className="w-full rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                                {di.uom || '-'}
                              </div>
                            </td>
                            <td className="p-2 align-top">
                              <div className="w-full rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                                {di.qtyPerUom || '-'}
                              </div>
                            </td>
                            <td className="p-2 align-top">
                              <input
                                type="number"
                                required
                                min={1}
                                value={di.qty || ''}
                                onChange={(e) => {
                                  const newItems = [...deliveryItems];
                                  newItems[index].qty = parseInt(e.target.value) || 0;
                                  setDeliveryItems(newItems);
                                }}
                                className="w-full rounded-xl border border-transparent bg-slate-50/50 px-3 py-2.5 text-xs font-black text-slate-800 focus:bg-white focus:border-brand-accent/30 focus:ring-2 focus:ring-brand-accent/10 outline-none transition-all"
                                placeholder="0"
                              />
                            </td>
                            {!editingDelivery && (
                              <td className="p-2 align-top text-center pt-3">
                                <button 
                                  type="button" 
                                  onClick={() => setDeliveryItems(deliveryItems.filter((_, i) => i !== index))}
                                  className={`p-1.5 rounded-lg transition-colors ${deliveryItems.length > 1 ? 'text-rose-400 hover:bg-rose-50 hover:text-rose-600' : 'text-slate-200 cursor-not-allowed'}`}
                                  disabled={deliveryItems.length <= 1}
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
                  
                  {!editingDelivery && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryItems([...deliveryItems, { itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
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
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">OR Number</label>
                    <input
                      value={deliveryDetails.orNumber}
                      onChange={(e) => setDeliveryDetails({ ...deliveryDetails, orNumber: e.target.value })}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-mono font-bold text-slate-500 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner"
                      placeholder="UN-OR-XXXX"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Received By</label>
                    <input
                      required
                      list="receivedBySuggestions"
                      value={deliveryDetails.receivedBy}
                      onChange={(e) => setDeliveryDetails({ ...deliveryDetails, receivedBy: e.target.value })}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner"
                      placeholder="Enter full verification name"
                    />
                    <datalist id="receivedBySuggestions">
                      {receivedBySuggestions.map(name => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] ml-1">Date</label>
                    <input
                      type="date"
                      required
                      value={deliveryDetails.dateDelivered}
                      onChange={(e) => setDeliveryDetails({ ...deliveryDetails, dateDelivered: e.target.value })}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-sm font-bold text-slate-900 focus:border-brand-accent/30 focus:bg-white focus:outline-none transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t border-slate-50">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      setEditingDelivery(null);
                      setDeliveryDetails({
                        dateDelivered: format(new Date(), 'yyyy-MM-dd'), orNumber: '', receivedBy: ''
                      });
                      setDeliveryItems([{ itemId: '', category: '', description: '', uom: '', qty: 0, qtyPerUom: '' }]);
                    }}
                    className="rounded-2xl px-6 py-4 text-xs font-extrabold uppercase tracking-[0.2em] text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-2xl bg-brand-primary px-10 py-4 text-xs font-extrabold uppercase tracking-[0.2em] text-white shadow-xl shadow-slate-200 hover:bg-slate-800 hover:-translate-y-0.5 transition-all"
                  >
                    {editingDelivery ? 'Update Delivery' : 'Save Delivery'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        title="Delete Delivery"
        message="Are you sure you want to delete this delivery record? This will subtract the corresponding quantity from inventory. This action cannot be undone."
        confirmLabel="Delete Delivery"
        variant="danger"
        onConfirm={() => {
          if (deleteConfirm.delivery) handleDelete(deleteConfirm.delivery);
          setDeleteConfirm({ isOpen: false, delivery: null });
        }}
        onCancel={() => setDeleteConfirm({ isOpen: false, delivery: null })}
      />

      <ExportModal
        isOpen={exportModal}
        onClose={() => setExportModal(false)}
        onExportExcel={handleExportExcel}
        onPrint={handlePrint}
        title="Export Deliveries"
      />
    </div>
  );
};

export default Deliveries;
