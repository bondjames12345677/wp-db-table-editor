if(typeof(console)=='undefined')console={log:function(){}};
if(typeof(DBTableEditor)=='undefined') DBTableEditor={};

if ( !Date.prototype.toISOString ) {
  ( function() {
    function pad(number) {
      if ( number < 10 ) {
        return '0' + number;
      }
      return number;
    }
    Date.prototype.toISOString = function() {
      return moment(this).toISOString();
    };
  }() );
}
DBTableEditor.defaultOffset = new Date().getTimezoneOffset();
DBTableEditor.parseDate = function(ds, dontRec){
  if(!ds) return null;
  else if(ds.getTime) return ds;
  else if(typeof(ds)!='string') return null;
  var m = moment(ds);
  if(!m.isValid) return null;
  return moment(ds).toDate();
  return d;
};

DBTableEditor.toISO8601 = function(ds){
  var d = DBTableEditor.parseDate(ds);
  if(d) return d.toISOString();
  return null;
};


// based on https://github.com/brondavies/SlickGrid/commit/d5966858cd4f7591ba3da5789009b488ad05b021#diff-7f1ab5db3c0316e19a9ee635a1e2f2d0R1374
DBTableEditor.defaultValueFormatter = function (row, cell, value, columnDef, dataContext) {
  var dv = DBTableEditor.parseDate(value);
  //console.log(row, cell, value, columnDef, dv);
  if (value == null) {
    return "";
  } else if (value.toLocaleDateString ) {
    return value.toLocaleDateString();
  } else if (dv && dv.toLocaleDateString ) {
    return dv.toLocaleDateString();
  } else {
    return (value + "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
};

DBTableEditor.parseQuery = function(query) {
    var obj = {};
    if(!query || query.length < 1) return obj;
    var vars = query.split('&');
    for (var i = 0; i < vars.length; i++) {
      var pair = vars[i].split('=');
      obj[decodeURIComponent(pair[0])]=decodeURIComponent(pair[1]);
    }
    return obj;
};
DBTableEditor.commandQueue =[];
DBTableEditor.queueAndExecuteCommand = function(item, column, editCommand){
  DBTableEditor.commandQueue.push(editCommand);
  editCommand.execute();
};

DBTableEditor.saveFailCB = function(err, resp){
  console.log('SAVE FAILED', err, resp);
  jQuery('button.save').attr("disabled", null);
  var src = jQuery('button.save img').attr('src');
  jQuery('button.save img').attr('src',src.replace('loading.gif','accept.png'));

};
DBTableEditor.saveCB = function(data){
  console.log('Save Success');
  jQuery('button.save').attr("disabled", null);
  var src = jQuery('button.save img').attr('src');
  jQuery('button.save img').attr('src',src.replace('loading.gif','accept.png'));

  var pair;
  while((pair = data.pop())){
    var item = DBTableEditor.dataView.getItemById( pair.rowId );
    item[DBTableEditor.columnMap[DBTableEditor.id_column]] = pair.dbid;
    DBTableEditor.dataView.updateItem(pair.rowId, item);
  }
  DBTableEditor.clearPendingSaves();
};

DBTableEditor.clearFilters = function(){
  DBTableEditor.columnFilters = {};
  jQuery(DBTableEditor.grid.getHeaderRow())
   .find(':input').each(function(){jQuery(this).val('');});
  DBTableEditor.dataView.refresh();
};

DBTableEditor.save = function(){
  jQuery('button.save').attr("disabled", "disabled");
  var src = jQuery('button.save img').attr('src');
  jQuery('button.save img').attr('src',src.replace('accept.png','loading.gif'));

  // the last time we modified a row should contain all the final modifications
  var it,h = {},i,r, toSave=[], mod = DBTableEditor.modifiedRows.slice(0), modified;
  while(( r = mod.pop() )){
    var column = DBTableEditor.data.columns[r.cell];
    if(column.isDate){
      var dv = DBTableEditor.parseDate(r.item[r.cell-1]);
      if(dv) r.item[r.cell-1] = dv.toISOString();
      console.log(r.item, dv, r.cell, column, r.item[r.cell-1]);
    }

    // cells have a delete idx to be removed
    if((it = h[r.item.id])){
      it.modifiedIdxs.push(r.cell-1);
      continue;
    }
    r.item.modifiedIdxs = [r.cell-1];
    h[r.item.id] = r.item;
    toSave.push(r.item);
  }
  //console.log(toSave);
  var cols = DBTableEditor.data.columns.map(function(c){return c.originalName;});
  cols.shift(); // remove buttons
  var toSend = JSON.stringify({
    modifiedIdxs:toSave.map(function(it){return it.modifiedIdxs;}),
    columns:cols,
    rows:toSave
  });

  jQuery.post(ajaxurl, {action:'dbte_save', data:toSend, table:DBTableEditor.table})
    .success(DBTableEditor.saveCB)
    .error(DBTableEditor.saveFailCB);

};

DBTableEditor.undo = function () {
  var command = DBTableEditor.commandQueue.pop();
  if (command && Slick.GlobalEditorLock.cancelCurrentEdit()) {
    command.undo();
    DBTableEditor.popPendingSaves(2);// remove the undo, and the undone thing
    DBTableEditor.grid.gotoCell(command.row, command.cell, false);
  }
  return false;
};
DBTableEditor.gotoNewRow = function () {
  DBTableEditor.grid.gotoCell(DBTableEditor.grid.getDataLength(), 0, true);
};


DBTableEditor.filterRow = function (item) {
  //console.log(item);
  var columnFilters = DBTableEditor.columnFilters,
      grid = DBTableEditor.grid;
  // dont filter the new row
  if(item.newRow) return true;
  for (var columnId in columnFilters) {
    if (columnId !== undefined && columnFilters[columnId] !== "") {
      var cidx = grid.getColumnIndex(columnId);
      var c = grid.getColumns()[cidx];
      if(!c) continue;
      var filterVal = columnFilters[columnId];
      if(filterVal && filterVal.length > 0){
        // if we have a formatted value, lets check our value both formatted
        // and unformatted against the search term both formatted and unformatted
        // primarily to standardize dates currently
        if( c.formatter ){
          var re = new RegExp(filterVal,'i');
          var val = item[c.field] && item[c.field].toString();
          if( !val ) continue;
          // row, cell, value, columnDef, dataContext
          var formatted = c.formatter(item, cidx, val, c, null);
          var formattedFilter = c.formatter(item, cidx, filterVal, c, null);
          var reformattedFilter = new RegExp(formattedFilter,'i');
          if ((val.search(re) < 0)
              && (val.search(reformattedFilter) < 0)
              && (formatted.search(re) < 0)
              && (formatted.search(reformattedFilter) < 0)) {
            return false;
          }
        }
        else{
          var re = new RegExp(filterVal,'i');
          if (item[c.field].toString().search(re) < 0) {
            return false;
          }
        }
      }
    }
  }
  return true;
};

DBTableEditor.deleteSuccess = function(data, id, rowId){
  console.log('Removed', data, id, rowId);
  DBTableEditor.dataView.deleteItem(rowId);
};

DBTableEditor.deleteFail = function(err, resp){
  console.log('delete failed', err, resp);
};

DBTableEditor.deleteHandler = function(el){
  var btn = jQuery(el);
  var id = btn.data("id");
  var rowid = btn.data('rowid');
  var row = DBTableEditor.dataView.getItemById(rowid);
  var rObj = {};
  btn.parents('.slick-row').addClass('active');
  if(!id){
    console.log("Cannot delete, no ID", btn.data());
    return;
  }
  if(!btn.is('button'))btn = btn.parents('button');
  if (!confirm('Are you sure you wish to remove this row')) return;

  // we have an empty column first for delete buttons
  for(var i=0,c=null,v=null;c=DBTableEditor.data.columns[i+1];i++)
    rObj[c.originalName]=row[i];

  var reqArgs = jQuery.extend({action:'dbte_delete', dataid:id, rowid:rowid, table:DBTableEditor.table}, rObj);
  //console.log(rObj, reqArgs);
  jQuery.post(ajaxurl, reqArgs)
   .success(function(data){DBTableEditor.deleteSuccess(data, id, rowid);})
   .error(DBTableEditor.deleteFail);
  return false;
};
DBTableEditor.extraButtons=[];
DBTableEditor.rowButtonFormatter = function(row, cell, value, columnDef, dataContext) {
  // if(row==0)console.log(row,cell, value, columnDef, dataContext);
  var id = dataContext[DBTableEditor.columnMap[DBTableEditor.id_column]];
  var rowid = dataContext.id; // uses id, NOT id_column
  if(!id) return null;
  var url = DBTableEditor.baseUrl+'/assets/images/delete.png';
  var out = '<button title="Delete this Row" class="delete" onclick="DBTableEditor.deleteHandler(this);return false;"'+
    ' data-rowid="'+rowid+'" '+
    ' data-id="'+id+'" />'+
    '<img src="'+url+'"/></button>';
  jQuery.each(DBTableEditor.extraButtons, function(i,fn){
    out += fn(row, cell, value, columnDef, dataContext);
  });
  return out;
};

DBTableEditor.exportCSV = function(){
  var url = jQuery(DBTableEditor.grid.getHeaderRow())
   .find(':input').filter(function(){return jQuery(this).val().length>0;})
   .serialize();
  var args=jQuery.extend({}, DBTableEditor.query, DBTableEditor.hashQuery);
  delete(args["page"]);
  var url = ajaxurl+'?action=dbte_export_csv&table='+DBTableEditor.table
   +'&'+jQuery.param(args)
   +'&'+url;
  console.log('Redirecting to export:', url);
  window.location=url;
};

DBTableEditor.updatePagingInfo = function(){
  var cnt = DBTableEditor.dataView.getPagingInfo()["totalRows"];
  jQuery('.db-table-editor-row-count').text ("Showing "+cnt+" of "+DBTableEditor.data.rows.length+" rows");
};

DBTableEditor._ids_ ={};
DBTableEditor.newId = function(id){
  var newid=id;
  while(!newid || DBTableEditor._ids_[newid]){
    newid = Math.floor(Math.random() * 100000)*100000;}
  DBTableEditor._ids_[newid]=true;
  return newid;
};

DBTableEditor.popPendingSaves = function(n){
  if(n==null) n = 1;
  var rtn, it;
  if(n == 1)
    rtn = DBTableEditor.modifiedRows.pop();
  else {
    rtn=[];
    // while we havent popped enough and there are things to pop
    while(n-->0 && (it=DBTableEditor.modifiedRows.pop())) rtn.push(it);
  }
  jQuery('.pending-save-count').text(DBTableEditor.modifiedRows.length);
  return rtn;
};

DBTableEditor.clearPendingSaves = function(){
  DBTableEditor.modifiedRows = [];
  jQuery('.pending-save-count').text(DBTableEditor.modifiedRows.length);
};
DBTableEditor.addPendingSave = function(args){
  DBTableEditor.modifiedRows.push(args);
  jQuery('.pending-save-count').text(DBTableEditor.modifiedRows.length);
};

DBTableEditor.onload = function(opts){
  // TODO: switch to objects so there can be more than one table to edit *sigh*
  //console.log('Loading db table');
  DBTableEditor.query = DBTableEditor.parseQuery(window.location.search.substring(1));
  DBTableEditor.hashQuery = DBTableEditor.parseQuery(window.location.hash.substring(1));

  jQuery.extend(DBTableEditor, opts);
  if(!DBTableEditor.id_column) DBTableEditor.id_column='id';
  DBTableEditor.id_column = DBTableEditor.id_column.toLowerCase();
  if(!DBTableEditor.data){ return console.log("No Data for DBTableEditor");}
  var rows = DBTableEditor.data.rows;
  var columns = DBTableEditor.data.columns;
  var columnMap = DBTableEditor.columnMap = {};
  DBTableEditor.columnNameMap = DBTableEditor.columnNameMap||{};
  if(typeof(DBTableEditor.noedit_columns)=="string")
    DBTableEditor.noedit_columns = DBTableEditor.noedit_columns.split(/\s*,\s*/);
  if(typeof(DBTableEditor.hide_columns)=="string")
    DBTableEditor.hide_columns = DBTableEditor.hide_columns.split(/\s*,\s*/);
  DBTableEditor.default_values = DBTableEditor.parseQuery(opts.default_values);

  // init columns
  for( var i=0, c ; c=columns[i] ; i++){
    c.id=c.name.toLowerCase();
    if(c.isDate === null) c.isDate = false;
    if(c.id.indexOf("date")>=0) c.isDate = true;
    if(c.isDate){
      if(!c.formatter) c.formatter = DBTableEditor.defaultValueFormatter;
      if(!c.editor) c.editor = Slick.Editors.Date;
    }



    c.originalName = c.name;
    if(DBTableEditor.columnNameMap[c.name]){
      c.name = DBTableEditor.columnNameMap[c.name];
    }
    else{
      c.name = c.name.replace("_"," ");
    }
    c.field = i;
    c.sortable = true;
    if(jQuery.inArray(c.originalName, DBTableEditor.hide_columns)>-1){
      c.maxWidth=c.minWidth=c.width=5;
      c.resizable=c.selectable=c.focusable=false;
    }
    if(jQuery.inArray(c.originalName, DBTableEditor.noedit_columns)>-1){
      c.focusable=false;
      c.selectable=false;
      c.cannotTriggerInsert=true;
    }
    //account for buttons column at 0 if needed
    columnMap[c.id] = i; //DBTableEditor.noedit ? i : i+1;

    if(c.id!=DBTableEditor.id_column && !c.editor){
      var maxLen = 0;
      for(var j=0 ; j < 100 ; j++){
        if(rows[j] && rows[j][c.field]){
          maxLen = Math.max(rows[j][c.field].toString().length, maxLen);
        }
        else{
          // console.log(j, rows[j], c.field, rows[j][c.field]);
        }
      }
      if(maxLen < 65) c.editor = Slick.Editors.Text;
      else c.editor = Slick.Editors.LongText;
    }
  }
  if(columnMap[DBTableEditor.id_column]==null){
    console.log('Couldnt find a column:', DBTableEditor.id_column," defaulting to noedit");
    DBTableEditor.noedit = true;
  }
  if(!DBTableEditor.noedit)
    columns.unshift({id: 'buttons', formatter:DBTableEditor.rowButtonFormatter, width:75});

  //init rows
  for(var i=0, r ; r=rows[i] ; i++){
    // r.shift(null);
    var rid = DBTableEditor.newId((columnMap[DBTableEditor.id_column]!=null) && r[columnMap[DBTableEditor.id_column]]);
    // THIS MUST BE named ID in order for slickgrid to work
    r.id = rid;
    if(!DBTableEditor.noedit) r.push(null);
  }

  var options = {
    enableCellNavigation: true,
    enableColumnReorder: true,
    editable: !DBTableEditor.noedit,
    enableAddRow: !DBTableEditor.noedit,
    multiColumnSort:true,
    autoEdit:false,
    editCommandHandler: DBTableEditor.queueAndExecuteCommand,
    showHeaderRow: true,
    headerRowHeight: 30,
    defaultColumnWidth:120,
    explicitInitialization: true
  };

  DBTableEditor.columnFilters = jQuery.extend(DBTableEditor.columnFilters,DBTableEditor.query,DBTableEditor.hashQuery);
  delete(DBTableEditor.columnFilters["page"]);
  var dataView = DBTableEditor.dataView = new Slick.Data.DataView({ inlineFilters: true });
  var grid = DBTableEditor.grid = new Slick.Grid('.db-table-editor', dataView, columns, options);
  grid.setSelectionModel(new Slick.CellSelectionModel());
  var nextCell = function (args){
    if(!args) return;
    var ri = args.row === null ? rows.length-1 : args.row,
        ci = args.cell=== null ? 1 : args.cell + 1 ;
    if(ci >= columns.length){
      ci=0;
      ri++;
    }
    //console.log("going to:", ri, ci, args);
    grid.gotoCell(ri, ci, true);
  };

  DBTableEditor.clearPendingSaves();
  grid.onAddNewRow.subscribe(function (e, args) {
    var newItem = args.item;
    var item = [], v, max=0;
    for(var i=0; i < DBTableEditor.data.columns.length ; i++){
      v  = newItem[i];
      if(v){
        max = i;
        item[i] = v;
      }
    }
    jQuery.each(DBTableEditor.default_values,function(k,v){
      item[DBTableEditor.columnMap[k]]=v;
    });
    grid.invalidateRow(rows.length);
    item.id = DBTableEditor.newId();
    item.newRow = true;
    dataView.addItem(item);
    grid.updateRowCount();
    grid.render();
    DBTableEditor.addPendingSave(args);
    DBTableEditor.mostRecentEdit = new Date();
    nextCell({row:DBTableEditor.grid.getDataLength()-1, cell:max+1});
  });

  grid.onCellChange.subscribe(function(e, args){
    var item = args.item;
    //console.log('edit', e, args, item);
    DBTableEditor.addPendingSave(args);
    DBTableEditor.mostRecentEdit = new Date();
    nextCell(args);
  });

  grid.onSort.subscribe(function(e, args){ // args: sort information.
    var cols = args.sortCols;
    var typedVal = function(c, r, n){
      var v = r[n];
      if(c.type == 'int') return Number(v);
      else if(c.id.search('date')>=0) return new Date(v);
      return v && v.toLowerCase();
    };
    var rowSorter = function (r1, r2) {
      for (var c, i=0; c=cols[i]; i++) {
        var field = c.sortCol.field;
        var sign = c.sortAsc ? 1 : -1;
        var value1 = typedVal(c.sortCol,r1,field),
            value2 = typedVal(c.sortCol,r2,field);
        var result = (value1 == value2 ? 0 : (value1 > value2 ? 1 : -1)) * sign;
        if (result != 0) {
          return result;
        }
      }
      return 0;
    };
    dataView.sort(rowSorter);
    grid.invalidate();
    grid.render();
  });

  dataView.onRowCountChanged.subscribe(function (e, args) {
    grid.updateRowCount();
    grid.render();
    DBTableEditor.updatePagingInfo();
  });

  dataView.onRowsChanged.subscribe(function (e, args) {
    grid.invalidateRows(args.rows);
    grid.render();
    DBTableEditor.updatePagingInfo();
  });

  jQuery(grid.getHeaderRow()).delegate(":input", "change keyup", function (e) {
    var columnId = jQuery(this).data("columnId");
    if (columnId != null) {
      DBTableEditor.columnFilters[columnId] = jQuery.trim(jQuery(this).val());
      dataView.refresh();
    }
  });

  grid.onHeaderRowCellRendered.subscribe(function(e, args) {
      jQuery(args.node).empty();
      if(args.column.id == "buttons") return;
      jQuery("<input type='text'>")
         .data("columnId", args.column.id)
         .val(DBTableEditor.columnFilters[args.column.id])
         .attr('name','filter-'+args.column.id)
         .appendTo(args.node);
  });

  grid.init();
  if(columns.length < 8) grid.autosizeColumns();

  dataView.beginUpdate();
  dataView.setItems(rows);
  dataView.setFilter(DBTableEditor.filterRow);
  dataView.endUpdate();
  dataView.refresh();

  DBTableEditor.updatePagingInfo();

  jQuery('button.save').attr("disabled", null);


  //console.log('Finished loading db table');
};
